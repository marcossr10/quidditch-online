# Sistema de Negociación de Fichajes — Diseño

## Idea general

Hay **dos vías distintas para fichar jugadores**, separadas por el consentimiento:

| Vía | Coste | Quién decide | Garantía |
|---|---|---|---|
| **Cláusula** | Alto (valor × 1.8) | Solo tú | Total (nadie puede negarse) |
| **Negociación** | Menor (55–110% del valor) | El jugador (y el club vendedor) | Ninguna: puede rechazar o contraofertar |

### Regla de oro
- **Pagar una cláusula** = el jugador se va a tu equipo sí o sí, da igual lo que piensen el otro club o el jugador. Es la vía "forzosa": cara, limitada, pero garantizada.
- **Negociar** = el jugador tiene la última palabra. Solo acepta si cree que está **igual de bien o mejor en tu club** que en el suyo. Si piensa que está mejor donde está, te rechaza.

---

## 1. La cláusula (vía forzosa) — ya existe, se mantiene

Sigue funcionando como hasta ahora:
- Precio: `max(valor × 1.8, ReleaseClause)`.
- Límite: 2 cláusulas pagadas por mes (`clausePurchasesByMonth`).
- Bloqueo: comprado por cláusula no puede volver a ser clausulado durante 61 días (`clauseLockUntil`).
- Blindado: no se puede comprar de ninguna forma hasta que expire el blindaje.
- Sin negociación, sin fallo, sin consentimiento.

---

## 2. La negociación (vía del consentimiento)

### Cómo se inicia
En la ficha del jugador (o en el mercado), en vez de solo el botón de cláusula, se añade **"Hacer oferta"**:
- **Tarifa**: ofertar entre 55% y 110% de su valor. (Subir hasta la cláusula = compra garantizada.)
- **Salario**: entre 0.7× y 1.2× del salario actual, para ajustar el coste semanal.
- Solo se puede negociar con **clubes AI (cláusulas)**; los agentes libres y transferibles mantienen su fichaje directo inmediato (opcionalmente solo se negocia el salario).

### Índice de atractividad comparativo
El jugador compara **tu club contra el suyo**. Si tu club es claramente superior o él está mal en el suyo, acepta.

Factores que se suman a su predisposición:

1. **Reputación** (`ReputationStars`): si tu reputación es menor que la de su club → muy difícil que acepte.
2. **Clasificación actual** (posición en la tabla): un líder de liga no se viene a un colista.
3. **Palmarés reciente**: si su club ganó liga/copa/eurocopa/campeones **esta temporada**, se queda.
4. **Moral del jugador**: si está feliz (moral alta, titular, ganando) se resiste más. Si está descontento, se va encantado.
5. **Dinero como persuasión**: un salario muy superior a su salario actual puede doblegar su voluntad aunque tu equipo sea peor.

Fórmula de aceptación (orientativa):
```
aceptación = base
  + (tuReputación    - repulscubRival)   * peso
  + (tuPosición      - suPosición)        * peso
  + (tusTrofeosTemporada - susTrofeosTemporada) * peso
  + (moral baja del jugador -> más dispuesto)
  + (tuOfertaSalarial >> suSalario -> más dispuesto)
```

### Respuestas posibles (máx. 2 rondas)
- **Acepta**: se completa el traspaso por la tarifa negociada (`completeTransfer`).
- **Contraoferta**: devuelve un precio/salario intermedio y puedes volver a ofertar (máx. 2 rondas).
- **Rechaza**: la oferta queda anulada y no puedes volver a ofertar por él ese mes.

### Consecuencias (drama realista)
- **Si el jugador te rechaza**: sube un poco su moral (se siente querido) y no puedes re-ofertar ese mes.
- **Si tú le rechazas** a él (contraoferta que nunca aceptas): se mosquea, baja su moral y **puede pedir salir al mercado solo** (se lista automáticamente). Crea movimiento de mercado.
- **Ambición del jugador**: si un gran jugador (p. ej. 90 OVR) está en un club que lucha por no descender, se irá encantado aunque su club tenga más reputación histórica. Evita que las estrellas rechacen todo siempre.

---

## 3. Reglas de seguridad que se respetan (sin cambios)

- **Blindado** (`shieldedUntil`): no se puede comprar ni negociar hasta que expire.
- **Cláusula bloqueada** (`clauseLockUntil`): no se puede negociar ni clausular durante el bloqueo.
- **Límite de 2 compras cláusula/mes** se mantiene (las negociaciones aceptadas NO cuentan en ese límite).
- **Nacionalidad/liga**: solo se puede comprar jugadores de tu liga (`leagueId === state.leagueId`), como ya ocurre.

---

## 4. Implementación técnica

- **Estado**: `state.negotiation = { playerId, round, lastOffer }` guardado en el guardado (con migración en `loadState`).
- **UI**: modal nuevo en `render` con atributos `data-offer-*` (monto, salario, confirmar/cancelar). Se abre desde la ficha del jugador en modo negociación.
- **Lógica**: función `resolveNegotiation(offer)` que calcula la probabilidad con el índice de atractividad y devuelve aceptar/contraoferta/rechazo. Si acepta, llama a `completeTransfer`.
- **Fichaje directo**: agentes libres y transferibles mantienen su botón actual de fichaje inmediato (sin fricción para suplentes).

---

## Resumen jugable

- **Quiero fijo y no me importa pagar** → cláusula (cara, garantizada, con límites).
- **Quiero ahorrar y puedo arriesgar** → negociación (barata, pero el jugador decide según su club, palmarés, moral y tú poder persuadirlo con salario).
- **La gracia del sistema**: que pagar una cláusula signifique "lo compro y punto", y negociar signifique "le convenzo de que su futuro está en mi club".