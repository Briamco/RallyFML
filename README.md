# RallyFML

Aplicación para configurar un rally por estaciones, registrar puntajes desde dispositivos de moderación y mostrar el marcador y el podio en vivo.

## Desarrollo local

Requiere Node.js 24, pnpm 12 y Docker.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
```

Edita `apps/api/.env` y reemplaza `SESSION_SECRET`, `CREDENTIAL_PEPPER` y `BOOTSTRAP_SECRET` por valores propios. Luego levanta PostgreSQL y la aplicación:

```sh
docker compose up -d db
pnpm db:migrate
pnpm dev
```

Antes de migrar, espera a que `docker compose ps` muestre `healthy` para el servicio `db`.

Abre `http://localhost:5173`. La primera visita a **Administración** crea la cuenta usando el secreto de aprovisionamiento; después de crearla, elimina `BOOTSTRAP_SECRET` del entorno.

Para ejecutar toda la aplicación en contenedores:

```sh
docker compose up --build
```

## Comprobaciones

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm test:e2e
```

Playwright espera que el frontend esté disponible en `http://localhost:5173`; instala Chromium una vez con `pnpm exec playwright install chromium`. `PLAYWRIGHT_BASE_URL` permite cambiar la dirección.

## Railway

Despliega el `Dockerfile` como un servicio y agrega PostgreSQL gestionado. Configura `DATABASE_URL`, `SESSION_SECRET`, `CREDENTIAL_PEPPER`, `BOOTSTRAP_SECRET` y `PUBLIC_ORIGIN` como variables del servicio. `PUBLIC_ORIGIN` debe ser el origen HTTPS exacto asignado por Railway. Las migraciones se aplican antes de iniciar el servidor. Tras crear la cuenta de administración, elimina `BOOTSTRAP_SECRET`.

Mantén una instancia de API en v1: Socket.IO no usa un adaptador compartido entre réplicas. Los valores predeterminados de Compose son solo para desarrollo; no los uses en producción. Los archivos de Indivisa no se incluyen hasta confirmar autorización para uso web.
