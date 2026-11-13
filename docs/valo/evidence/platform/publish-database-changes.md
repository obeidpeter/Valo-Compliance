Source: https://docs.replit.com/features/data-and-storage/publish-database-changes
Retrieved: 2026-11-13T16:30:48.858Z
Representation: webFetch extracted markdown; compatibility research, not legal-content evidence.

> ## Documentation Index
>
> Fetch the complete documentation index at: [/llms.txt](https://docs.replit.com/llms.txt)
>
> Use this file to discover all available pages before exploring further.

[Skip to main content](https://docs.replit.com/features/data-and-storage/publish-database-changes#content-area)

Assistant

Responses are generated using AI and may contain mistakes.

When you publish an app that uses a Replit-managed database, Replit brings your production database up to date with your development database for you. You don’t write or run migrations yourself. During publishing, Replit:

1. Compares the schema of your development and production databases.
2. Generates the SQL needed to make production match development.
3. Asks you to resolve anything ambiguous, such as a renamed column.
4. Validates the SQL against a copy of your production database.
5. Applies the SQL to production after your app builds and before the new version goes live.

This only applies to databases Replit manages for your app. If your published app connects to an external database such as Supabase, a Neon project you created yourself, or Amazon RDS, Publish doesn’t change that database. Use that provider’s migration workflow instead.

## [Navigate to header: Step 1: Replit detects changes](https://docs.replit.com/features/data-and-storage/publish-database-changes\#step-1-replit-detects-changes) Step 1: Replit detects changes

Publishing starts with a **Provision** stage. If your development schema differs from production, the Publish pane shows **Development database changes detected** and starts generating migrations.

![Publish pane showing Development database changes detected](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/changes-detected.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=9213aa45a2b15109f3cffc451fb7efdf)

Publishing migrates tables, columns, indexes, constraints, views, enums, sequences, and row-level security policies. Some objects aren’t carried over; see [Unsupported database objects](https://docs.replit.com/help/troubleshooting/databases#unsupported-database-objects).

## [Navigate to header: Step 2: Answer questions about ambiguous changes](https://docs.replit.com/features/data-and-storage/publish-database-changes\#step-2-answer-questions-about-ambiguous-changes) Step 2: Answer questions about ambiguous changes

Some schema changes can mean two different things. When Replit can’t tell which you intended, it pauses with **Detected potential conflicts, please review** and asks you to choose. Pick an option and select **Submit**.

### [Navigate to header: Rename or new?](https://docs.replit.com/features/data-and-storage/publish-database-changes\#rename-or-new) Rename or new?

If a column was removed and another added on the same table, Replit asks whether the old column was renamed.

- **Yes, rename column** keeps the existing data under the new name.
- **No, create new column** adds an empty column and drops the old one along with its data.

![Prompt asking whether a removed column should be renamed to a newly added column](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/rename-column-prompt.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=fe35615b66e1cc80a57b0198926d5406)

The same question appears for tables, enums, sequences, views, and schemas.

![Prompt asking whether a removed table should be renamed to a newly added table](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/rename-table-prompt.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=f3bfb9ba5604a051e845ae3617e42270)

Choosing **create new** for something that was really a rename is the most common way to lose production data during a publish. If you’re not sure, cancel the publish and ask Agent what changed.

### [Navigate to header: Unique constraint on a table with data](https://docs.replit.com/features/data-and-storage/publish-database-changes\#unique-constraint-on-a-table-with-data) Unique constraint on a table with data

If you add a unique constraint to a table that already has rows in production, Replit tells you how many rows the constraint will check.

- **Add the constraint as-is** fails the migration if any existing rows violate it. You can then fix the data and publish again.
- **Remove all rows, then add the constraint** clears the table first. This option isn’t offered when other tables reference this one through a foreign key.

![Prompt asking how to add a unique constraint to a table that already has rows](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/unique-constraint-prompt.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=0a399148516559f9f2711cc335254df2)

## [Navigate to header: Step 3: Review the generated SQL](https://docs.replit.com/features/data-and-storage/publish-database-changes\#step-3-review-the-generated-sql) Step 3: Review the generated SQL

After any questions are answered, the pane shows **Generated migrations to apply to production database** with the exact SQL Replit will run. Read it before you continue.

![Generated migration SQL shown in the Publish pane](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/generated-migrations.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=d8737c76546c059cdfcf0adead1e9e29)

Two signals tell you a migration needs extra attention:

- **Data-loss warning.**When a change could remove data from a table that has rows in production, the pane turns orange and lists each affected table with its row count. Changes that trigger this include:
  - Removing or recreating a column or table
  - Changing a column’s type or whether it requires a value
  - Adding a required column
  - Adding or recreating indexes and constraints
- **Downtime notice.** When a change isn’t compatible with the version of your app that’s currently running, Replit stops the running app before applying the migration so users can’t write to the database mid-change. Expand **What’s happening?** for details.

![Migration with an orange data-loss warning listing affected tables and a downtime notice](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/data-loss-warning.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=fc53902e5f2c4db51429cfc04f0e2746)

The warning list only includes tables that contain rows in production. A `DROP TABLE` on an empty table shows no warning, so read the SQL even when the pane isn’t orange.

## [Navigate to header: Step 4: Replit validates the migration](https://docs.replit.com/features/data-and-storage/publish-database-changes\#step-4-replit-validates-the-migration) Step 4: Replit validates the migration

Replit creates a temporary copy of your production database and runs the SQL against it. The pane shows **Validating database migrations…** and then **Database migrations validated successfully**.

![Publish pane showing database migrations validated successfully](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/validated.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=7127c8d7f2e63d87be279b5a0fff4e69)

If the SQL fails on the copy, the pane shows **Migrations failed validation, please review** with the database error and three ways forward:

| Option | What it does |
| --- | --- |
| **Ask Agent to investigate and fix the development schema** | Agent reads the failed SQL and error, compares your development schema with a read-only view of production, and fixes the development side. Production isn’t changed. Publish again when it’s done. |
| **Cancel deployment and retry once your schema conflicts are resolved** | Stops the publish. Nothing changes in production. |
| **Copy your development database schema & data to production** | Replaces your production schema **and data** with development. This can only be undone with [data recovery](https://docs.replit.com/features/data-and-storage/data-recovery). Use it only for apps with no production data worth keeping. |

![Publish pane showing migrations failed validation with three resolution options](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/validation-failed.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=0ece6685e16081c9d3525121441ee5a0)

Apps using a [Databricks Lakebase](https://docs.replit.com/connectors/warehouses/databricks) database follow the same migration validation flow. Lakebase does not support **Copy your development database schema & data to production**.

## [Navigate to header: Step 5 (optional): Preview your app on the migrated copy](https://docs.replit.com/features/data-and-storage/publish-database-changes\#step-5-optional--preview-your-app-on-the-migrated-copy) Step 5 (optional): Preview your app on the migrated copy

After validation succeeds, you can select **Create preview deploy** to build your app against the migrated copy of production. When the build finishes, select **View preview** to open it.

![Publish pane while a preview deploy is building](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/preview-building.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=18d331eba4d12dd001b6084d20481bac)

![Publish pane with View preview and Approve and publish buttons](https://mintcdn.com/replit/zZK4j3xeOuUOp6xy/images/databases/publish-database-changes/preview-ready.png?fit=max&auto=format&n=zZK4j3xeOuUOp6xy&q=85&s=1ed89987ab33ff747694a9460681cc4a)

Use the preview to click through the parts of your app the schema change touches. The preview uses the copied data, so anything you do there doesn’t affect production. Previews expire **2 hours** after they’re created; create a new one if you need more time.

## [Navigate to header: Step 6: Approve and publish](https://docs.replit.com/features/data-and-storage/publish-database-changes\#step-6-approve-and-publish) Step 6: Approve and publish

Select **Approve and publish** to continue. Replit sends the exact SQL you reviewed along with the publish request, so what you saw is what runs.Publishing then proceeds through the remaining stages. The migration runs **after your app finishes building and before the new version is promoted**:

1. Security checks
2. Build
3. Database migration applied to production
4. Bundle and promote the new version

Because Replit applies the migration at this point, your app’s build command and startup code should never change the database schema. Don’t add `drizzle-kit push`, `db:push`, or `CREATE TABLE IF NOT EXISTS` statements to the deployment build command or your server’s entrypoint. They would run on every publish, outside the review and validation above.

Once you approve, the migration can’t be recalled from the Publish pane. If you need to undo a schema change after publishing, make the reverse change in development and publish again, or use [data recovery](https://docs.replit.com/features/data-and-storage/data-recovery).

If you ask Agent to republish instead of using the Publish pane and your development and production schemas differ, the republish is blocked and you’re directed back to the Publish pane to review the migration.

## [Navigate to header: Make changes to production manually](https://docs.replit.com/features/data-and-storage/publish-database-changes\#make-changes-to-production-manually) Make changes to production manually

For one-off fixes, you can run SQL directly against production from the Database pane: select **Production** in the database switcher, then use the SQL console. See [Work with your data](https://docs.replit.com/features/data-and-storage/work-with-your-data#run-sql-commands).Replit always compares the actual databases, not your schema file, so any manual change becomes part of the next publish’s comparison. If you add a column by hand in production that doesn’t exist in development, the next publish proposes dropping it.

## [Navigate to header: Next steps](https://docs.replit.com/features/data-and-storage/publish-database-changes\#next-steps) Next steps

- [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production): Understand how your two databases differ.
- [Data recovery](https://docs.replit.com/features/data-and-storage/data-recovery): Restore development or production data.
- [Unsupported database objects](https://docs.replit.com/help/troubleshooting/databases#unsupported-database-objects): Objects Publish can’t migrate.

