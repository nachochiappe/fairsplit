-- Store a validated icon choice for every detailed and super category so inferred
-- suggestions can be overridden without relying on display-name heuristics.
ALTER TABLE "Category"
ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'receipt';

UPDATE "Category"
SET "icon" = CASE
  WHEN lower("name") ~ '(internet|wifi|broadband|telefono|teléfono|phone)' THEN 'wifi'
  WHEN lower("name") ~ '(alquiler|casa|hogar|home|house|housing|mortgage|rent)' THEN 'home'
  WHEN lower("name") ~ '(essential|grocer|market|mercado|shop|super(mercado)?)' THEN 'cart'
  WHEN lower("name") ~ '(auto|bus|cabify|car|combustible|fuel|mobility|movilidad|nafta|parking|taxi|train|transport|uber)' THEN 'car'
  WHEN lower("name") ~ '(bank|banco|credit|credito|crédito|debt|finance|finanza|impuesto|investment|loan|money|seguro|tax)' THEN 'wallet'
  WHEN lower("name") ~ '(comida|delivery|dinner|food|lunch|restaurant|restaurante)' THEN 'utensils'
  WHEN lower("name") ~ '(flight|hotel|trip|travel|vacacion|vacación|viaje|vuelo)' THEN 'plane'
  WHEN lower("name") ~ '(birthday|cumple|gift|regalo)' THEN 'gift'
  WHEN lower("name") ~ '(gatita|gato|mascota|perro|veterinaria)' THEN 'paw'
  WHEN lower("name") ~ '(donation|family|familia|love|pareja)' THEN 'heart'
  WHEN lower("name") ~ '(doctor|farmacia|health|medical|medico|médico|pharmacy|salud)' THEN 'medical'
  WHEN lower("name") ~ '(book|college|education|escuela|school|study|universidad)' THEN 'graduation'
  WHEN lower("name") ~ '(business|empresa|office|trabajo|work)' THEN 'briefcase'
  WHEN lower("name") ~ '(cleaning|garden|jardin|jardín|limpieza|maintenance|repair|service)' THEN 'tools'
  WHEN lower("name") ~ '(clothes|clothing|ropa|shirt|zapato)' THEN 'shirt'
  WHEN lower("name") ~ '(deporte|fitness|gym|gimnasio|sport|training)' THEN 'dumbbell'
  WHEN lower("name") ~ '(baby|bebe|bebé|child|hijo|kid|nino|niño)' THEN 'baby'
  WHEN lower("name") ~ '(entertainment|game|gaming|juego|streaming|videojuego)' THEN 'gamepad'
  WHEN lower("name") ~ '(cafe|café|coffee|merienda)' THEN 'coffee'
  WHEN lower("name") ~ '(diversion|diversión|fun|lifestyle|ocio|salida|subscription)' THEN 'sparkles'
  ELSE 'receipt'
END;

UPDATE "SuperCategory"
SET "icon" = CASE
  WHEN "icon" IN (
    'home', 'cart', 'car', 'wallet', 'sparkles', 'dots', 'utensils', 'plane', 'gift',
    'paw', 'heart', 'medical', 'graduation', 'briefcase', 'tools', 'wifi', 'shirt',
    'dumbbell', 'baby', 'gamepad', 'receipt', 'coffee'
  ) THEN "icon"
  WHEN lower("name") ~ '(alquiler|casa|hogar|home|house|housing|mortgage|rent)' THEN 'home'
  WHEN lower("name") ~ '(essential|grocer|market|mercado|shop|super(mercado)?)' THEN 'cart'
  WHEN lower("name") ~ '(auto|car|mobility|movilidad|transport)' THEN 'car'
  WHEN lower("name") ~ '(bank|banco|finance|finanza|money)' THEN 'wallet'
  WHEN lower("name") ~ '(travel|vacacion|vacación|viaje)' THEN 'plane'
  WHEN lower("name") ~ '(family|familia)' THEN 'heart'
  WHEN lower("name") ~ '(diversion|diversión|fun|lifestyle|ocio|salida)' THEN 'sparkles'
  ELSE 'dots'
END;

ALTER TABLE "SuperCategory"
ALTER COLUMN "icon" SET DEFAULT 'dots',
ALTER COLUMN "icon" SET NOT NULL;
