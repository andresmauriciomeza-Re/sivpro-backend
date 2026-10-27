-- =============================================================================
-- Script opcional de semillas para tb_proveedores (NO se ejecuta automáticamente)
-- Idempotente: usa ON CONFLICT (nit) DO NOTHING.
-- =============================================================================

BEGIN;

INSERT INTO tb_proveedores (
  tipo_persona, nit, dv, nombre, nombre_comercial, tipo_sociedad,
  rep_legal_nombre, rep_legal_tipo_doc, rep_legal_num_doc, rep_legal_telefono, rep_legal_email,
  asesor_comercial, telefono, contacto_telefono_fijo, email, direccion, estado
)
VALUES
  (
    'Juridica', '8002514406', '6', 'Harinera del Valle S.A.', 'Harinera del Valle', 'S.A.',
    'Jorge Eliecer Paz', 'CC', '16789456', '3104567890', 'jpaz@harineradelvalle.com',
    'Carlos Andrés Mejía', '6024857890', '6024850000', 'ventas@harineradelvalle.com',
    'Calle 15 # 32-11, Cali, Valle del Cauca', TRUE
  ),
  (
    'Juridica', '8909039388', '8', 'Colanta Cooperativa', 'Colanta', 'Otra',
    'Sergio González', 'CC', '71654321', '3113004567', 'sgonzalez@colanta.com.co',
    'María Fernanda Ríos', '6044455500', '6044450000', 'pedidos@colanta.com.co',
    'Calle 74 # 64A-51, Medellín, Antioquia', TRUE
  ),
  (
    'Juridica', '8600029644', '4', 'Alquería S.A.', 'Alquería', 'S.A.',
    'Carlos Enrique Cavelier', 'CC', '79123456', '3152345678', 'ccavelier@alqueria.com.co',
    'Andrés Felipe Vargas', '6016507000', '6016500000', 'institucional@alqueria.com.co',
    'Km 5 Vía Cajicá, Cundinamarca', TRUE
  )
ON CONFLICT (nit) DO NOTHING;

COMMIT;
