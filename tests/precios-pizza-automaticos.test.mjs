import assert from 'node:assert/strict';
import test from 'node:test';
import { asignarPreciosPizza, preciosRecomendadosPizza } from '../src/utils/preciosPizza.js';

test('precios recomendados usan la pizza completa, margen y centena superior', () => {
  assert.deepEqual(preciosRecomendadosPizza(24000, 40), { mediana: 4200, grande: 5600 });
  assert.deepEqual(preciosRecomendadosPizza(12345, 25), { mediana: 2000, grande: 2600 });
  assert.deepEqual(preciosRecomendadosPizza(100, 0), { mediana: 100, grande: 200 });
});

test('asigna ambos recomendados si ambos precios son cero', () => {
  const resultado = asignarPreciosPizza(24000, 40, 0, 0);
  assert.equal(resultado.mediana, 4200);
  assert.equal(resultado.grande, 5600);
  assert.deepEqual(resultado.asignados.map((x) => x.tamano), ['Mediana', 'Grande']);
});

test('conserva Grande y limita Mediana a la centena inferior, señalando precio bajo costo', () => {
  const resultado = asignarPreciosPizza(24000, 40, 0, 3000);
  assert.equal(resultado.mediana, 2700);
  assert.equal(resultado.grande, 3000);
  assert.deepEqual(resultado.asignados, [{ tamano: 'Mediana', precio: 2700, porDebajoDelCosto: true }]);
});

test('conserva Mediana y eleva Grande al mínimo del 10 %', () => {
  const resultado = asignarPreciosPizza(24000, 40, 6000, 0);
  assert.equal(resultado.mediana, 6000);
  assert.equal(resultado.grande, 6600);
  assert.deepEqual(resultado.asignados, [{ tamano: 'Grande', precio: 6600, porDebajoDelCosto: false }]);
});

test('conserva ambos precios existentes sin exigir un cálculo de costos', () => {
  assert.deepEqual(asignarPreciosPizza(0, 40, 1000, 1050), {
    mediana: 1000, grande: 1050, asignados: [],
  });
});

test('no inventa un precio positivo cuando Grande no permite una centena válida', () => {
  assert.throws(() => asignarPreciosPizza(24000, 40, 0, 100), /No se pueden asignar precios válidos/);
});
