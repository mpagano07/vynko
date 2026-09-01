-- ============================================================
-- FIX: Revertir doble-codificación en productos y categorías.
--
-- Soporta dos patrones:
--   1. Latin-1:  Ã seguido de chars Latin-1 (ej: Ã¡ → á)
--   2. CP437:    Chars de box-drawing (ej: ├í → á, ├│ → ó)
--
-- PRIMERO ejecutar el SELECT de preview, DESPUÉS el UPDATE.
-- Ejecutar en Supabase SQL Editor:
--   https://supabase.com/dashboard/project/_/sql/new
-- ============================================================

-- 0. Función auxiliar para revertir CP437 double-encoding
CREATE OR REPLACE FUNCTION fix_cp437_encoding(input TEXT)
RETURNS TEXT AS $$
DECLARE
  result TEXT := '';
  ch TEXT;
  cp437_byte INT;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;

  FOR i IN 1..length(input) LOOP
    ch := substr(input, i, 1);
    cp437_byte := CASE ch
      WHEN E'\u251C' THEN 195   -- ├ → 0xC3
      WHEN E'\u2500' THEN 196   -- ─ → 0xC4
      WHEN E'\u253C' THEN 197   -- ┼ → 0xC5
      WHEN E'\u255E' THEN 197   -- ╞ → 0xC5 (alias)
      WHEN E'\u255F' THEN 198   -- ╟ → 0xC6
      WHEN E'\u255A' THEN 199   -- ╚ → 0xC7
      WHEN E'\u2554' THEN 200   -- ╔ → 0xC8
      WHEN E'\u2569' THEN 201   -- ╩ → 0xC9
      WHEN E'\u2566' THEN 202   -- ╦ → 0xCA
      WHEN E'\u2560' THEN 203   -- ╠ → 0xCB
      WHEN E'\u2550' THEN 204   -- ═ → 0xCC
      WHEN E'\u256C' THEN 205   -- ╬ → 0xCD
      WHEN E'\u2567' THEN 206   -- ╧ → 0xCE
      WHEN E'\u2568' THEN 207   -- ╨ → 0xCF
      WHEN E'\u2564' THEN 208   -- ╤ → 0xD0
      WHEN E'\u2565' THEN 209   -- ╥ → 0xD1
      WHEN E'\u2559' THEN 210   -- ╙ → 0xD2
      WHEN E'\u2558' THEN 211   -- ╘ → 0xD3
      WHEN E'\u2552' THEN 212   -- ╒ → 0xD4
      WHEN E'\u2553' THEN 213   -- ╓ → 0xD5
      WHEN E'\u256B' THEN 214   -- ╫ → 0xD6
      WHEN E'\u256A' THEN 215   -- ╪ → 0xD7
      WHEN E'\u2518' THEN 216   -- ┘ → 0xD8
      WHEN E'\u250C' THEN 217   -- ┌ → 0xD9
      WHEN E'\u2588' THEN 218   -- █ → 0xDA
      WHEN E'\u2584' THEN 219   -- ▄ → 0xDB
      WHEN E'\u258C' THEN 220   -- ▌ → 0xDC
      WHEN E'\u2590' THEN 221   -- ▐ → 0xDD
      WHEN E'\u2580' THEN 222   -- ▀ → 0xDE
      WHEN E'\u2502' THEN 179   -- │ → 0xB3
      WHEN E'\u2524' THEN 180   -- ┤ → 0xB4
      WHEN E'\u2561' THEN 181   -- ╡ → 0xB5
      WHEN E'\u2562' THEN 182   -- ╢ → 0xB6
      WHEN E'\u2556' THEN 183   -- ╖ → 0xB7
      WHEN E'\u2555' THEN 184   -- ╕ → 0xB8
      WHEN E'\u2563' THEN 185   -- ╣ → 0xB9
      WHEN E'\u2551' THEN 186   -- ║ → 0xBA
      WHEN E'\u2557' THEN 187   -- ╗ → 0xBB
      WHEN E'\u255D' THEN 188   -- ╝ → 0xBC
      WHEN E'\u255C' THEN 189   -- ╜ → 0xBD
      WHEN E'\u255B' THEN 190   -- ╛ → 0xBE
      WHEN E'\u2510' THEN 191   -- ┐ → 0xBF
      WHEN E'\u252C' THEN 193   -- ┬ → 0xC1
      WHEN E'\u2534' THEN 194   -- ┴ → 0xC2
      WHEN E'\u2591' THEN 176   -- ░ → 0xB0
      WHEN E'\u2592' THEN 177   -- ▒ → 0xB1
      WHEN E'\u2593' THEN 178   -- ▓ → 0xB2
      WHEN E'\u25C6' THEN 254   -- ◆ → 0xFE
      WHEN E'\u25CB' THEN 253   -- ○ → 0xFD
      WHEN E'\u25A1' THEN 255   -- □ → 0xFF
      WHEN E'\u2310' THEN 169   -- ⌐ → 0xA9
      WHEN E'\u221E' THEN 236   -- ∞ → 0xEC
      WHEN E'\u2229' THEN 240   -- ∩ → 0xF0
      WHEN E'\u2261' THEN 241   -- ≡ → 0xF1
      WHEN E'\u2265' THEN 242   -- ≥ → 0xF2
      WHEN E'\u2266' THEN 243   -- ≤ → 0xF3
      WHEN E'\u2202' THEN 246   -- ∂ → 0xF6
      WHEN E'\u221A' THEN 247   -- √ → 0xF7
      WHEN E'\u2219' THEN 248   -- ∙ → 0xF8
      WHEN E'\u2122' THEN 252   -- ™ → 0xFC
      WHEN E'\u03B1' THEN 224   -- α → 0xE0
      WHEN E'\u00DF' THEN 225   -- ß → 0xE1
      WHEN E'\u0393' THEN 226   -- Γ → 0xE2
      WHEN E'\u03C0' THEN 227   -- π → 0xE3
      WHEN E'\u03A3' THEN 228   -- Σ → 0xE4
      WHEN E'\u03C3' THEN 229   -- σ → 0xE5
      WHEN E'\u00B5' THEN 230   -- µ → 0xE6
      WHEN E'\u03C4' THEN 231   -- τ → 0xE7
      WHEN E'\u03A6' THEN 232   -- Φ → 0xE8
      WHEN E'\u0398' THEN 233   -- Θ → 0xE9
      WHEN E'\u03A9' THEN 234   -- Ω → 0xEA
      WHEN E'\u03B4' THEN 235   -- δ → 0xEB
      WHEN E'\u03C6' THEN 237   -- φ → 0xED
      WHEN E'\u03B5' THEN 238   -- ε → 0xEE
      WHEN E'\u00C7' THEN 128   -- Ç → 0x80
      WHEN E'\u00FC' THEN 129   -- ü → 0x81
      WHEN E'\u00E9' THEN 130   -- é → 0x82
      WHEN E'\u00E2' THEN 131   -- â → 0x83
      WHEN E'\u00E4' THEN 132   -- ä → 0x84
      WHEN E'\u00E0' THEN 133   -- à → 0x85
      WHEN E'\u00E5' THEN 134   -- å → 0x86
      WHEN E'\u00E7' THEN 135   -- ç → 0x87
      WHEN E'\u00EA' THEN 136   -- ê → 0x88
      WHEN E'\u00EB' THEN 137   -- ë → 0x89
      WHEN E'\u00E8' THEN 138   -- è → 0x8A
      WHEN E'\u00EF' THEN 139   -- ï → 0x8B
      WHEN E'\u00EE' THEN 140   -- î → 0x8C
      WHEN E'\u00EC' THEN 141   -- ì → 0x8D
      WHEN E'\u00C4' THEN 142   -- Ä → 0x8E
      WHEN E'\u00C5' THEN 143   -- Å → 0x8F
      WHEN E'\u00C9' THEN 144   -- É → 0x90
      WHEN E'\u00E6' THEN 145   -- æ → 0x91
      WHEN E'\u00C6' THEN 146   -- Æ → 0x92
      WHEN E'\u00F4' THEN 147   -- ô → 0x93
      WHEN E'\u00F6' THEN 148   -- ö → 0x94
      WHEN E'\u00F2' THEN 149   -- ò → 0x95
      WHEN E'\u00FB' THEN 150   -- û → 0x96
      WHEN E'\u00F9' THEN 151   -- ù → 0x97
      WHEN E'\u00FF' THEN 152   -- ÿ → 0x98
      WHEN E'\u00D6' THEN 153   -- Ö → 0x99
      WHEN E'\u00DC' THEN 154   -- Ü → 0x9A
      WHEN E'\u00A2' THEN 155   -- ¢ → 0x9B
      WHEN E'\u00A3' THEN 156   -- £ → 0x9C
      WHEN E'\u00A5' THEN 157   -- ¥ → 0x9D
      WHEN E'\u0192' THEN 159   -- ƒ → 0x9F
      WHEN E'\u00E1' THEN 160   -- á → 0xA0
      WHEN E'\u00ED' THEN 161   -- í → 0xA1
      WHEN E'\u00F3' THEN 162   -- ó → 0xA2
      WHEN E'\u00FA' THEN 163   -- ú → 0xA3
      WHEN E'\u00F1' THEN 164   -- ñ → 0xA4
      WHEN E'\u00D1' THEN 165   -- Ñ → 0xA5
      WHEN E'\u00AA' THEN 166   -- ª → 0xA6
      WHEN E'\u00BA' THEN 167   -- º → 0xA7
      WHEN E'\u00BF' THEN 168   -- ¿ → 0xA8
      WHEN E'\u00AC' THEN 170   -- ¬ → 0xAA
      WHEN E'\u00BD' THEN 171   -- ½ → 0xAB
      WHEN E'\u00BC' THEN 172   -- ¼ → 0xAC
      WHEN E'\u00A1' THEN 173   -- ¡ → 0xAD
      WHEN E'\u00AB' THEN 174   -- « → 0xAE
      WHEN E'\u00BB' THEN 175   -- » → 0xAF
      ELSE NULL
    END;

    IF cp437_byte IS NOT NULL THEN
      result := result || chr(cp437_byte);
    ELSE
      result := result || ch;
    END IF;
  END LOOP;

  -- Now interpret the collected bytes as UTF-8
  RETURN convert_from(convert_to(result, 'LATIN1'), 'UTF8');
EXCEPTION WHEN OTHERS THEN
  RETURN input;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- PATRÓN 1: Latin-1 double-encoding (Ã seguido de chars)
-- ============================================================

-- 1. Preview Latin-1
SELECT id, name,
       convert_from(convert_to(name, 'LATIN1'), 'UTF8') AS name_fixed
FROM products
WHERE name ~ 'Ã[¡-ÿÂ-Þ]'
LIMIT 50;

-- 2. Fix Latin-1: nombres de productos
UPDATE products
SET name = convert_from(convert_to(name, 'LATIN1'), 'UTF8')
WHERE name ~ 'Ã[¡-ÿÂ-Þ]';

-- 3. Fix Latin-1: descripciones de productos
UPDATE products
SET description = convert_from(convert_to(description, 'LATIN1'), 'UTF8')
WHERE description ~ 'Ã[¡-ÿÂ-Þ]';

-- 4. Fix Latin-1: nombres de categorías
UPDATE categories
SET name = convert_from(convert_to(name, 'LATIN1'), 'UTF8')
WHERE name ~ 'Ã[¡-ÿÂ-Þ]';

-- 5. Fix Latin-1: descripciones de categorías
UPDATE categories
SET description = convert_from(convert_to(description, 'LATIN1'), 'UTF8')
WHERE description ~ 'Ã[¡-ÿÂ-Þ]';

-- ============================================================
-- PATRÓN 2: CP437 double-encoding (chars de box-drawing)
-- Detecta: ├, │, ─, ┼, ┤, ┬, ┴, ┐, ┘, ┌, └, ═, ║, etc.
-- ============================================================

-- 6. Preview CP437
SELECT id, name,
       fix_cp437_encoding(name) AS name_fixed
FROM products
WHERE name ~ '[\u2500-\u257f\u2580-\u259f]'
LIMIT 50;

-- 7. Fix CP437: nombres de productos
UPDATE products
SET name = fix_cp437_encoding(name)
WHERE name ~ '[\u2500-\u257f\u2580-\u259f]';

-- 8. Fix CP437: descripciones de productos
UPDATE products
SET description = fix_cp437_encoding(description)
WHERE description ~ '[\u2500-\u257f\u2580-\u259f]';

-- 9. Fix CP437: nombres de categorías
UPDATE categories
SET name = fix_cp437_encoding(name)
WHERE name ~ '[\u2500-\u257f\u2580-\u259f]';

-- 10. Fix CP437: descripciones de categorías
UPDATE categories
SET description = fix_cp437_encoding(description)
WHERE description ~ '[\u2500-\u257f\u2580-\u259f]';

-- ============================================================
-- Cleanup: eliminar la función temporal
-- ============================================================
-- DROP FUNCTION IF EXISTS fix_cp437_encoding(TEXT);
