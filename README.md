# bezeroo-rag

Motor RAG especializado en normativa ambiental española. Ingesta normativa pública del BOE, genera embeddings vectoriales y responde consultas con citas jurídicas precisas.

## Stack

- **NestJS** + TypeScript
- **PostgreSQL** + **pgvector**
- **Prisma** ORM
- **OpenAI API** (embeddings + chat)

## Requisitos previos

- Node.js >= 18
- PostgreSQL >= 14
- pgvector (extensión de PostgreSQL)
- Cuenta de OpenAI con API key

### Instalar pgvector

**macOS (Homebrew):**

```bash
brew install pgvector
```

**Ubuntu/Debian:**

```bash
sudo apt install postgresql-16-pgvector
```

**Desde source (cualquier sistema):**

```bash
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

Después de instalar, activar la extensión en PostgreSQL:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Instalación

```bash
# 1. Clonar e instalar dependencias
git clone <repo-url>
cd bezeroo-rag
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores (ver sección siguiente)

# 3. Crear la base de datos
createdb rag

# 4. Sincronizar el esquema con la base de datos
npx prisma db push

# 5. Generar el cliente Prisma
npx prisma generate
```

## Variables de entorno

Copiar `.env.example` a `.env` y configurar:

```env
# Conexión a PostgreSQL
DATABASE_URL="postgresql://usuario:password@localhost:5432/rag?schema=public"

# OpenAI
OPENAI_API_KEY="sk-..."
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
OPENAI_CHAT_MODEL="gpt-4o-mini"

# Embedding (debe coincidir con el modelo elegido)
EMBEDDING_DIMENSIONS=1536

# App
PORT=3000
NODE_ENV=development
```

## Arrancar el servidor

```bash
# Desarrollo (con hot reload)
npm run start:dev

# Producción
npm run build
npm run start:prod
```

El servidor arranca en `http://localhost:3000`.

## Gestión de normativa (CLI)

Todas las operaciones de gestión se hacen con `npm run manage`:

```bash
# Ver qué documentos hay ingestados
npm run manage list

# Estadísticas del sistema (docs, chunks, embeddings)
npm run manage stats

# Ingestar una norma del BOE
npm run manage ingest-boe https://www.boe.es/buscar/act.php?id=BOE-A-2022-22690

# Ingestar desde un archivo JSON local
npm run manage ingest-file data/ley-26-2007-responsabilidad-medioambiental.json

# Forzar re-ingestión (si ya existe)
npm run manage ingest-boe https://www.boe.es/buscar/act.php?id=BOE-A-2022-22690 --force

# Comprobar actualizaciones de todas las normas del BOE
npm run manage update-all

# Eliminar un documento (acepta IDs parciales)
npm run manage delete a3f2

# Eliminar TODO y empezar limpio
npm run manage reset --confirm
```

### Protección contra duplicados

- Si intentas ingestar una norma que ya existe, el sistema lo bloquea.
- Con `--force`, compara un hash del contenido: si no cambió nada, no re-genera embeddings (ahorro de costes de OpenAI).
- `update-all` re-scrapea todas las normas y solo re-procesa las que cambiaron.

## API

### RAG — Consultas

```bash
# Hacer una pregunta sobre la normativa
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{"question": "¿Qué obligaciones tienen los productores de envases?"}'
```

Respuesta:

```json
{
  "answer": "Según el Real Decreto 1055/2022...",
  "citations": [
    {
      "officialId": "Real Decreto 1055/2022",
      "sectionType": "ARTICULO",
      "sectionNumber": "14"
    }
  ],
  "matchedChunks": [...]
}
```

### Documentos — Gestión

```bash
# Listar todos los documentos
curl http://localhost:3000/documents

# Estadísticas del sistema
curl http://localhost:3000/documents/stats

# Detalle de un documento
curl http://localhost:3000/documents/<id>

# Eliminar un documento (cascade: chunks + embeddings)
curl -X DELETE http://localhost:3000/documents/<id>
```

### Ingestión

```bash
# Ingestar desde BOE
curl -X POST http://localhost:3000/ingestion/boe \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.boe.es/buscar/act.php?id=BOE-A-2022-22690"}'

# Forzar re-ingestión
curl -X POST http://localhost:3000/ingestion/boe \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.boe.es/buscar/act.php?id=BOE-A-2022-22690", "force": true}'

# Ver jobs de ingestión
curl http://localhost:3000/ingestion/jobs
```

## Estructura del proyecto

```
src/
├── app.module.ts                     # Módulo raíz
├── main.ts                           # Punto de entrada
├── config/
│   └── configuration.ts              # Variables de entorno centralizadas
├── database/
│   ├── database.module.ts
│   └── prisma.service.ts             # Wrapper de PrismaClient
├── openai/
│   ├── openai.module.ts
│   └── openai.service.ts             # Embeddings + chat completions
├── legal-documents/
│   ├── legal-documents.module.ts
│   ├── legal-documents.controller.ts # CRUD de documentos
│   └── legal-documents.service.ts    # Lógica de negocio + stats
├── legal-chunks/
│   ├── legal-chunks.module.ts
│   └── legal-chunks.service.ts       # Chunks + embeddings + búsqueda vectorial
├── ingestion/
│   ├── ingestion.module.ts
│   ├── ingestion.controller.ts       # Endpoints de ingestión
│   ├── ingestion.service.ts          # Pipeline de ingestión
│   ├── dto/
│   │   └── ingest-document.dto.ts
│   ├── parsers/
│   │   ├── legal-document.parser.ts  # Parser JSON + tipos compartidos
│   │   └── pdf.parser.ts             # Stub preparado para PDF
│   └── scrapers/
│       └── boe.scraper.ts            # Scraper del BOE consolidado
├── rag/
│   ├── rag.module.ts
│   ├── rag.controller.ts             # POST /rag/query
│   ├── rag.service.ts                # Pipeline RAG completo
│   └── dto/
│       └── rag-query.dto.ts
├── health/
│   ├── health.module.ts
│   └── health.controller.ts          # GET /health
└── scripts/
    └── manage.ts                     # CLI de gestión
```

## Modelo de datos

```
LegalSource (BOE, DOUE...)
  └── LegalDocument (Ley 26/2007, RD 1055/2022...)
       └── LegalVersion (consolidado)
            ├── LegalSection (artículos, disposiciones, anexos)
            │    └── LegalChunk (texto + embedding vectorial)
            └── IngestionJob (registro del proceso)
```

Cada chunk mantiene referencia completa a su norma, versión y sección, permitiendo citas precisas en las respuestas RAG.

## Despliegue en servidor nuevo

```bash
# 1. Clonar, instalar, configurar .env
git clone <repo-url> && cd bezeroo-rag
npm install
cp .env.example .env
# Editar .env con las credenciales del servidor

# 2. Preparar base de datos
createdb rag
npx prisma db push
npx prisma generate

# 3. Ingestar la normativa necesaria
npm run manage ingest-boe https://www.boe.es/buscar/act.php?id=BOE-A-2022-22690
npm run manage ingest-boe https://www.boe.es/buscar/act.php?id=BOE-A-2007-11475
# ... más normas

# 4. Verificar
npm run manage stats

# 5. Arrancar
npm run build
npm run start:prod
```

## Scripts disponibles

| Script | Descripción |
|---|---|
| `npm run start:dev` | Servidor con hot reload |
| `npm run build` | Compilar TypeScript |
| `npm run start:prod` | Servidor en producción |
| `npm run manage` | CLI de gestión de normativa |
| `npm run db:generate` | Regenerar cliente Prisma |
| `npm run db:migrate` | Crear migración (desarrollo) |
| `npm run db:studio` | Abrir Prisma Studio (UI visual) |

## Herramientas útiles para desarrollo

```bash
# Explorar la base de datos visualmente
npx prisma studio

# Ver el esquema actual
npx prisma db pull
```
