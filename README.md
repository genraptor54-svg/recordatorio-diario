# Recordatorios — app con notificaciones push reales

App de recordatorios con backend en Node/Express. A diferencia de la versión
que corre solo en el navegador, esta sí puede avisarte aunque tengas la
pestaña/app cerrada, porque el aviso lo dispara un servidor, no tu navegador.

## Qué incluye

- Backend en Express con una base de datos simple en archivo (`data.json`)
- Notificaciones push reales usando el estándar Web Push (VAPID) — sin depender
  de Firebase ni de ningún servicio de terceros
- Un "cron" interno que revisa cada minuto si algún recordatorio venció y aún
  no se avisó
- Frontend con categorías (personal/trabajo), prioridad, círculo ✓ (a tiempo)
  o ✕ (tarde) al completar, historial completo, y estado del día
- Manifest para instalarla como app (ícono + pantalla completa)

## Cómo correrla en tu computador

```bash
npm install
cp .env.example .env
```

Genera tus propias llaves VAPID (recomendado por seguridad, aunque el proyecto
ya trae unas de ejemplo funcionando):

```bash
npx web-push generate-vapid-keys
```

Copia el `publicKey` y `privateKey` que te da ese comando dentro de `.env`.
Luego:

```bash
npm start
```

Abre `http://localhost:3000` en Chrome o Edge (Safari en iOS tiene soporte
limitado de Web Push). Dale clic a "🔔 activar alertas" y acepta el permiso
de notificaciones.

## Cómo ponerla en internet (para que funcione desde tu celular)

Las notificaciones push solo llegan si el servidor está corriendo en algún
lugar accesible por internet — no basta con tu computador apagado. Las
opciones más simples y gratuitas para un proyecto pequeño como este:

**Render.com** (recomendado, tiene capa gratuita):
1. Sube esta carpeta a un repositorio de GitHub
2. En Render, crea un "Web Service" nuevo apuntando a ese repo
3. Build command: `npm install` — Start command: `npm start`
4. En "Environment", agrega `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` con tus
   llaves (las de `.env`, sin subir el archivo `.env` mismo)
5. Cuando termine el deploy, te da una URL pública (algo como
   `https://tu-app.onrender.com`) — ábrela desde el celular y ya

**Railway.app** funciona igual de fácil, con pasos casi idénticos.

Importante: en la capa gratuita de Render el servidor "duerme" tras un rato
sin uso y se demora unos segundos en despertar con la primera visita — no
afecta las notificaciones ya programadas, solo la carga inicial de la página.

## Nota sobre `data.json`

Ahora mismo los datos se guardan en un archivo plano. Funciona perfecto para
uso personal, pero si en Render/Railway el servidor se reinicia, ese archivo
puede perderse (dependiendo del plan). Si más adelante quieres que los datos
sean 100% permanentes, el siguiente paso natural es cambiar `data.json` por
una base de datos real (SQLite con un volumen persistente, o Postgres) —
puedo ayudarte con eso cuando lo necesites.
