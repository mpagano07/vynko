-- ========================================
-- Distributed rate limiting buckets
-- Migration: 036_rate_limit_buckets.sql
-- ========================================
-- El limitador de tasa vivia en un `Map` dentro del proceso (`lib/rate-limit.ts`).
-- Eso no es un limitador en un despliegue con mas de una instancia: cada una
-- tiene su propio `Map`, con lo cual el limite real es `limite x instancias` y
-- ademas se reinicia en cada cold start. Un atacante que abre varias conexiones
-- contra instancias distintas evade el limite de forma trivial.
--
-- La solucion es que el contador viva fuera del proceso. Como el proyecto ya usa
-- Supabase, se resuelve en Postgres: no hace falta un vendor nuevo ni credenciales
-- nuevas, y el service role ya se usa en los paths calientes de la app.
--
-- `rate_limit_hit()` hace el incremento y la lectura del resultado en UNA sola
-- sentencia. Eso es lo que lo hace correcto: en Postgres un `SELECT` seguido de
-- un `UPDATE` deja una ventana entre ambos en la que dos requests concurrentes
-- leen el mismo contador y los dos lo incrementan, tarifa en silencio el limite.
-- `INSERT ... ON CONFLICT DO UPDATE` toma el lock de la fila dentro de la misma
-- sentencia, asi que los incrementos se serializan.
--
-- Ventana fija, no deslizante: es la misma semantica que tenia el `Map`, solo que
-- compartida. Migrarla a ventana deslizante seria un cambio de comportamiento
-- deliberado, no un efecto secundario de esto.
--
-- Idempotente.
-- ========================================

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key      TEXT PRIMARY KEY,
  count    INTEGER     NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL,
  -- `count` nunca es negativo: un CHECK documenta el invariante en la base, en
  -- vez de depender de que ningun camino de codigo lo respete.
  CONSTRAINT rate_limit_buckets_count_positive CHECK (count >= 0)
);

-- El unico indice que se necesita ademas de la PK es el de `reset_at`, para que
-- la purga de filas vencidas no termine recorriendo la tabla entera.
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at
  ON rate_limit_buckets(reset_at);

-- Sin RLS utilizable: la tabla solo se toca con el service role desde el
-- servidor. Se deja RLS habilitado sin policies, que es el estado por defecto de
-- las tablas nuevas en Supabase y hace que un anon/authenticated no lea nada
-- aunque alguien publikara la tabla.
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- Idempotencia al re-aplicar la migracion sobre una base ya existente.
DROP FUNCTION IF EXISTS rate_limit_hit(TEXT, INTEGER, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS rate_limit_reset_if_expired();

-- Registra un intento y devuelve el estado de la ventana.
--
-- Devuelve (ok, retry_after_seconds):
--   ok = true  -> el intento esta dentro del limite
--   ok = false -> se excedio; retry_after_seconds = cuanto falta para que se
--                 libere la ventana
--
-- `p_probabilistic_cleanup` dispara la purga de filas vencidas. Se pasa en
-- `true` de forma esporadica desde el servidor en vez de en cada llamada: la
-- purga es un DELETE con indice, pero hay que pagarla, y hacerlo siempre seria
-- un DELETE constante por una tabla que en su mayor parte son claves activas.
CREATE OR REPLACE FUNCTION rate_limit_hit(
  p_key                      TEXT,
  p_limit                    INTEGER,
  p_window_ms                INTEGER,
  p_probabilistic_cleanup    BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (ok BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
-- INVOKER, no DEFINER, y no es un detalle menor: es lo que hace que la guarda
-- de mas abajo pueda distinguir a quien llama.
--
-- Con SECURITY DEFINER la funcion corre como su dueno, asi que `current_user`
-- devuelve el dueno y no sirve para saber quien la invoco. Habria que leer el
-- rol del claim del JWT, y se comprobo que en este proyecto ese claim NO
-- coincide con el rol efectivo (una llamada con la service key llega con
-- rol=authenticated), o sea que el control habria bloqueado a la propia app.
--
-- Con INVOKER, `current_user` es el rol con el que PostgREST ejecuto el
-- `SET LOCAL ROLE`, o sea el caller real. Ademas elimina la escalacion de
-- privilegios: la funcion no corre con mas permisos que su llamador.
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count    INTEGER;
  v_reset_at TIMESTAMPTZ;
BEGIN
  -- Guarda de llamada: la funcion se niega a si misma para cualquiera que no sea
  -- el service role, sin depender de como esten los ACL.
  --
  -- Por que no alcanza con los REVOKE de mas abajo: se comprobo que aun con
  -- `REVOKE ... FROM PUBLIC` aplicado, anon y authenticated seguiAN ejecutando
  -- la funcion por PostgREST. El revoke se reflejaba en el spec de la API, pero
  -- no en la ejecucion real, o sea que hay una via de permiso que no se ve desde
  -- el listado. En vez de seguir persiguiendo el origen de ese permiso, la
  -- funcion valida su propio invariante: asi el control no depende de que el ACL
  -- este bien.
  --
  -- Es fallo-seguro: si el rol no se puede determinar, `current_user` no puede
  -- ser NULL, pero la comparacion sigue siendo exacta; y si alguien quisiera que
  -- sacar el `SET LOCAL ROLE`, el rol pasaria a ser `authenticator`, que
  -- tampoco es `service_role` y por lo tanto tambien se niega.
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'rate_limit_hit: solo service_role puede llamarla (rol=%)', current_user
      USING ERRCODE = '42501';
  END IF;


  IF p_key IS NULL OR p_key = '' THEN
    -- Una clave vacia agruparia a todos los clientes en la misma ventana, que es
    -- exactamente lo contrario de lo que se quiere. Se permite el paso en vez de
    -- fallar: un bug de construccion de la clave no debe dejar la app sin
    -- servicio, y se avisa por log del lado del servidor.
    RETURN QUERY SELECT TRUE, 0;
    RETURN;
  END IF;

  IF p_limit <= 0 THEN
    RAISE EXCEPTION 'rate_limit_hit: p_limit must be > 0, got %', p_limit;
  END IF;

  IF p_probabilistic_cleanup THEN
    -- Las claves que dejan de usarse se quedan para siempre si nadie las purga.
    DELETE FROM rate_limit_buckets WHERE reset_at <= now();
  END IF;

  -- Ventana fija. Si la ventana anterior ya vencio, el contador vuelve a 1 y la
  -- ventana se reabre; si no, se acumula. Ambas ramas en la misma sentencia para
  -- que el incremento sea atomico.
  INSERT INTO rate_limit_buckets AS b (key, count, reset_at)
  VALUES (
    p_key,
    1,
    now() + make_interval(secs => p_window_ms::double precision / 1000.0)
  )
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                   WHEN b.reset_at <= now() THEN 1
                   ELSE b.count + 1
                 END,
        reset_at = CASE
                     WHEN b.reset_at <= now() THEN now() + make_interval(secs => p_window_ms::double precision / 1000.0)
                     ELSE b.reset_at
                   END
  RETURNING b.count, b.reset_at
  INTO v_count, v_reset_at;

  RETURN QUERY
    SELECT
      v_count <= p_limit AS ok,
      CASE
        WHEN v_count <= p_limit THEN 0
        ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_reset_at - now()))))
      END::INTEGER;
END;
$$;

COMMENT ON FUNCTION rate_limit_hit(TEXT, INTEGER, INTEGER, BOOLEAN) IS
  'Contador de ventana fija compartido entre instancias. atomico en una sola sentencia.';

-- Expurga de claves vencidas. Se expone por separado para poder dispararla desde
-- un cron externo (pg_cron, GitHub Actions, etc.) sin depender de que haya
-- trafico que la dispare.
CREATE OR REPLACE FUNCTION rate_limit_reset_if_expired()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- Misma guarda que `rate_limit_hit`, y mas importante aca: esta funcion borra
  -- filas. Si quedara expuesta, cualquiera con la anon key (que va en el bundle
  -- del navegador) podria dispararla en loop para forzar DELETEs y tomar locks
  -- sobre la tabla, frenando los limites legitimos.
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'rate_limit_reset_if_expired: solo service_role puede llamarla (rol=%)', current_user
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM rate_limit_buckets WHERE reset_at <= now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Revocar el acceso a anon/authenticated de forma explicita. Con RLS habilitado
-- y sin policies ya no pueden leer nada, pero dejarlo escrito evita que alguien
-- agregue un GRANT mas adelante sin notar el efecto.
REVOKE ALL ON rate_limit_buckets FROM anon, authenticated;

--
-- OJO: esto es lo que realmente cierra la funcion, y no lo de arriba.
--
-- Postgres concede `EXECUTE` sobre las funciones a `PUBLIC` por defecto, y los
-- privilegios de un rol son la UNION de los suyos y los de `PUBLIC`. Por eso
-- `REVOKE ... FROM anon, authenticated` NO alcanza: quita el permiso directo de
-- esos dos roles, pero el de `PUBLIC` sigue granting y la funcion queda
-- ejecutable por cualquiera que tenga la anon key (que va en el bundle del
-- navegador, o sea es publica).
--
-- Sin esto, un atacante podia llamar la funcion por PostgREST con la clave de su
-- victima y agotarle el limite de login, dejandolo afuera del sistema. Y como
-- `p_key` es arbitrario tambien podia inflar la tabla con claves inventadas
-- (con ventanas largas) hasta consuming espacio, o llamar
-- `rate_limit_reset_if_expired()` en loop para forzar DELETEs y tomar locks
-- sobre la tabla que frenan a los limites legitimos.
--
-- Para dejar el permiso solo al service role: revocar de PUBLIC y concesiones
-- explicitas unicamente a quien lo necesita.
--
-- OJO: con `REVOKE FROM PUBLIC` el spec de la API dejo de listar las funciones
-- para anon, pero en la practica anon y authenticated las seguiAN ejecutando por
-- PostgREST. O sea que el ACL no era la unica via de acceso y no se pudo cerrar
-- solo con permisos. Por eso la garantia real NO es de esta linea, es de la
-- guarda `current_user` dentro de cada funcion: aunque el permiso se filtrara otra
-- vez, la funcion se niega. Los revoke quedan como primera linea de defensa.
REVOKE ALL ON FUNCTION rate_limit_hit(TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION rate_limit_reset_if_expired() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION rate_limit_hit(TEXT, INTEGER, INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION rate_limit_reset_if_expired() TO service_role;

-- defense en depth: la tabla nunca deberia ser legible ni por PUBLIC.
REVOKE ALL ON rate_limit_buckets FROM PUBLIC;
