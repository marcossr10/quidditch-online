# Servidor online — Quidditch Manager v1.4.0

El servidor simula la temporada **solo** con un reloj virtual y los
jugadores entran a verla y a gestionar su equipo en vivo.

## Cómo funciona

- **Mismo motor que el cliente**: importa `src/app.js` tal cual (headless)
  y avanza con `advanceDay()`. Cero lógica duplicada.
- **Reloj virtual**: cada sala tiene `dayMs` (ms reales por día de juego,
  configurable por sala: 30 s – 30 min). El tick calcula los días que tocan
  por reloj y los simula (máx. 10 por ciclo). La fecha del juego solo se
  mueve vía `advanceDay()`: imposible que "salte" días.
- **Catch-up**: si el servidor duerme (plan gratis) o reinicia, al despertar
  simula los días pendientes. Parece 24/7 sin serlo.
- **Persistencia**: `server/data/rooms/<id>.json` (escritura atómica).
- **Mundial**: el estado se sustituye durante el torneo; los flags online
  viajan con él y el cliente muestra una vista de espera.
- **Acciones**: alineación, fichajes, blindajes, renovaciones y
  negociaciones se ejecutan en el servidor con impersonación
  (`managerTeamId` = tu equipo) y whitelist. El servidor manda.

## Desarrollo local

```bash
cd server
npm install
npm start        # http://localhost:8787 (TCP) + ws
```

El cliente (bundle) apunta por defecto a `ws://localhost:8787`.
Cámbialo en el lobby online si usas otra URL.

## Despliegue gratis (Render)

1. Sube el repo a GitHub.
2. En Render: New → Web Service → selecciona el repo.
   `render.yaml` ya define todo (plan free).
3. Apunta el juego a `wss://tu-servicio.onrender.com` en el lobby.

Nota: el plan gratis duerme tras 15 min sin tráfico; al despertar hace
catch-up automático de los días perdidos.

## Protocolo (resumen)

- `create` → `{snapshot, managerToken, creatorToken}`. Solo el creador
  (presentando `creatorToken`) puede borrar la sala (`delete`).
- `join {roomId, teamId, nick, token?}` → los equipos quedan ligados al
  nick: el mismo mánager reentra con su token; otro nick es rechazado y
  un nick con equipo no puede cambiar (`YA_TIENES_EQUIPO`).
- Cada snapshot trae `pendingResults` (partidos de tu equipo desde la
  última entrega) y los limpia al enviar: en vivo o al reentrar, el
  cliente los muestra en el popup de resultado.

## Tests

```bash
cd server
node test-boot.mjs         # motor headless + 40 días sin pausas
node test-integration.mjs  # salas, tokens, borrado, reloj, persistencia, reinicio
node test-results.mjs      # colas de resultados sin duplicados
node test-season.mjs       # 600 días: 2 temporadas + Mundial sin pausas
node test-client.mjs       # Chrome headless: lobby, popup resultado, reloj
node test-saves.mjs        # slots: crear, cambiar, borrar, rejoin online
node test-solo.mjs         # single-player sin regresiones
```
