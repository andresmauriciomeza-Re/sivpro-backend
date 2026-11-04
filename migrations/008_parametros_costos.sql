BEGIN;

CREATE TABLE tb_parametros_costos (
  id_parametro INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY
    CHECK (id_parametro = 1),
  salario_base NUMERIC(12, 2) NOT NULL DEFAULT 1750905
    CHECK (salario_base >= 0),
  auxilio_transporte NUMERIC(12, 2) NOT NULL DEFAULT 249095
    CHECK (auxilio_transporte >= 0),
  factor_prestacional NUMERIC(5, 2) NOT NULL DEFAULT 52
    CHECK (factor_prestacional >= 0),
  jornada_semanal NUMERIC(4, 1) NOT NULL DEFAULT 42
    CHECK (jornada_semanal > 0),
  personas_preparacion INTEGER NOT NULL DEFAULT 1
    CHECK (personas_preparacion >= 0),
  tarifa_gas_m3 NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (tarifa_gas_m3 >= 0),
  consumo_gas_m3_hora NUMERIC(8, 3) NOT NULL DEFAULT 0
    CHECK (consumo_gas_m3_hora >= 0),
  margen_ganancia NUMERIC(5, 2) NOT NULL DEFAULT 40
    CHECK (margen_ganancia >= 0),
  fecha_actualizacion TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO tb_parametros_costos DEFAULT VALUES
ON CONFLICT (id_parametro) DO NOTHING;

COMMIT;
