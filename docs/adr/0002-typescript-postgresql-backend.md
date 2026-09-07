# Use a TypeScript modular backend with PostgreSQL

The user delegated backend stack selection and clarified that CapRover is only an installation target. Use TypeScript on a supported Node.js LTS release with Fastify, PostgreSQL, Drizzle ORM, Zod-validated REST contracts with OpenAPI, Better Auth, and PDFKit. Organize one backend application into modules for identity/membership, venues, inventory, productions, and exports. This keeps the initial deployment small while allowing the future service to grow; compared with NestJS, Fastify requires more explicit module conventions but introduces less framework machinery. TypeScript allows geometry and layout validation logic to be shared with the browser, independent of Three.js rendering.

Store memberships, inventory, and record relationships relationally, and use schema-versioned JSONB for layout documents and frozen snapshots. Use database transactions for revision creation and atomic editing-lease changes; check lease ownership and saved revision numbers on writes so expired editors cannot overwrite newer work. Scope application data to a workspace from the start, while exposing only the agreed single-group workflow initially. The trade-off is application-level validation and migration of layout documents in exchange for preserving whole designs and historical revisions together.

Better Auth handles Pocket ID through generic OIDC and the alternative email/password flow. Workspace membership and roles remain application-controlled, with invitations required for access through either sign-in method. Brevo sends invitation and recovery emails. PDFKit generates vector construction drawings from the frozen layout model with explicit scale and pagination. Scale, tiling, elevations, and warning presentation are application responsibilities, not turnkey PDFKit features. Keep export work off the API event loop. Store uploaded references and generated PDFs in persistent file storage behind a storage interface.

Use containers and environment-based configuration for deployment. CapRover-specific installation files remain separate from domain and API code. Exact compatible stable package versions will be pinned and integration-tested during implementation; these choices are a design decision, not a claim of a tested implementation.

## Supporting documentation

- [Fastify type providers](https://fastify.dev/docs/latest/Reference/Type-Providers/): schema-driven TypeScript route types, including Zod support.
- [NestJS OpenAPI](https://docs.nestjs.com/openapi): the more framework-prescriptive alternative considered.
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions) and [migrations](https://orm.drizzle.team/docs/migrations).
- [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html).
- [Better Auth Fastify integration](https://better-auth.com/docs/integrations/fastify), [generic OAuth/OIDC](https://better-auth.com/docs/plugins/generic-oauth), and [email/password](https://better-auth.com/docs/authentication/email-password).
- [PDFKit](https://pdfkit.org/): programmatic PDF generation with vector graphics.
