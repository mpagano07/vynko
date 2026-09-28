-- 037_rate_limit_peek.sql
--
-- Agrega `rate_limit_peek`: consulta el estado de un limite SIN incrementarlo.
--
-- Por que hace falta: con un unico `rate_limit_hit` que incrementa, no hay forma
-- de bloquear un request que ya esta sobre el limite sin contar tambien ese
-- intento. Eso obligaba a incrementar antes de saber si la autenticacion
-- tendria exito, o sea que un login correcto consumia presupuesto igual que uno
-- fallido. Con el limite de cuenta en 5 por 15 minutos, el sexto login
-- correcto de la misma IP recibia 429.
--
-- Para un usuario legitimo detras de una IP compartida (oficina, CGNAT de
-- operador movil) eso es un bloqueo sin que nunca haya fallado una credencial, y
-- el nombre de la constante (`MAX_FAILED_ATTEMPTS`) describia algo que el codigo
-- no hacia.
--
-- Con esta funcion el flujo del login queda: peek (no cuenta) -> autenticar ->
-- si fallo, hit (cuenta). Los logins exitosos no escriben nada.
--
-- El limite sigue siendo correcto para el atacante: los intentos fallidos si se
-- cuentan, asi que 5 intentos fallidos bloquean al sexto, igual que antes.

CREATE OR REPLACE FUNCTION rate_limit_peek(
  p_key   TEXT,
  p_limit INTEGER
)
RETURNS TABLE (ok BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
-- INVOKER por el mismo motivo que en rate_limit_hit: es lo que permite validar
-- con `current_user` quien llama, y evita la escalacion de privilegios.
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count    INTEGER;
  v_reset_at TIMESTAMPTZ;
BEGIN
  -- Misma guarda que en rate_limit_hit: el control no depende del ACL.
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'rate_limit_peek: solo service_role puede llamarla (rol=%)', current_user;
  END IF;

  IF p_limit IS NULL OR p_limit <= 0 THEN
    RAISE EXCEPTION 'rate_limit_peek: p_limit must be > 0, got %', p_limit;
  END IF;

  SELECT b.count, b.reset_at
    INTO v_count, v_reset_at
    FROM public.rate_limit_buckets b
   WHERE b.key = p_key;

  -- Sin bucket, o con la ventana vencida, todavia no se consumio nada.
  IF v_count IS NULL OR v_reset_at <= now() THEN
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  -- Se bloquea cuando el contador YA alcanzo el limite, que es el caso en el que
  -- el proximo intento fallido lo excederia. Asi el comportamiento observable es
  -- el de siempre: con limite 5, los intentos 1 a 5 responden 401 y el 6to, 429.
  RETURN QUERY
    SELECT v_count < p_limit,
           CASE
             WHEN v_count < p_limit THEN 0
             ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_reset_at - now())))::INTEGER)
           END;
END $$;

-- Mismo permissions que 036. El revoke de anon y authenticated no es opcional:
-- Supabase aplica ALTER DEFAULT PRIVILEGES que otorga EXECUTE sobre funciones
-- nuevas del schema public a esos dos roles con permiso DIRECTO, asi que revocar
-- solo de PUBLIC deja el ACL abierto. Ver el comentario de 036.
REVOKE ALL ON FUNCTION rate_limit_peek(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION rate_limit_peek(TEXT, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rate_limit_peek(TEXT, INTEGER) TO service_role;
