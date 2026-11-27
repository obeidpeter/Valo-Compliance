Source: https://docs.replit.com/features/data-and-storage/data-recovery
Retrieved: 2026-11-13T16:30:48.858Z
Representation: webFetch extracted markdown; compatibility research, not legal-content evidence.

> ## Documentation Index
>
> Fetch the complete documentation index at: [/llms.txt](https://docs.replit.com/llms.txt)
>
> Use this file to discover all available pages before exploring further.

[Skip to main content](https://docs.replit.com/features/data-and-storage/data-recovery#content-area)

Assistant

Responses are generated using AI and may contain mistakes.

Sometimes you want your data back the way it was: a schema change didn’t work out, or you explored a direction for your app and decided against it. Replit keeps history for both of your databases so you can go back.

| Database | Recovery method | On by default | How far back |
| --- | --- | --- | --- |
| Development | Checkpoint rollback | Yes | Any Agent checkpoint, up to 7 days |
| Production | Point-in-time recovery (PITR) | Yes, 7 days | Any moment in the last 7 days. Pro, Teams, and Enterprise: up to 28 days |
| Production | Scheduled backups | No | Daily restore points while the database is active, kept 7 days. Pro, Teams, and Enterprise: up to 28 days |

## [​](https://docs.replit.com/features/data-and-storage/data-recovery\#who-can-restore-a-database)  Who can restore a database

Restoring changes live data, so it’s limited to people who can already edit the database.

- **Personal apps**: the owner and collaborators with edit access.
- **Workspace apps**: members with the Editor, Publisher, or Owner [access level](https://docs.replit.com/teams/identity-and-access-management/groups-and-permissions#access-levels) on the app. Members with Read-only access can’t restore.

Scheduled backups are available on Core, Pro, Teams, and Enterprise.

## [​](https://docs.replit.com/features/data-and-storage/data-recovery\#restore-your-development-database)  Restore your development database

Your development database is restored together with your code through [checkpoint rollback](https://docs.replit.com/features/version-control/checkpoints-and-rollbacks/). Select **Rollback here** on any checkpoint Agent created. The confirmation dialog lists what’s affected: your files, your development database, and Agent’s memory all return to the state they were in at that checkpoint.

Checkpoint rollback never touches your production database. To recover production data, use one of the methods below.

## [​](https://docs.replit.com/features/data-and-storage/data-recovery\#restore-your-production-database-to-a-point-in-time)  Restore your production database to a point in time

Point-in-time recovery (PITR) keeps a continuous history of your production database. It’s turned on when the database is created, with a 7-day window, and you can restore to any second inside that window.

### [​](https://docs.replit.com/features/data-and-storage/data-recovery\#change-the-retention-window)  Change the retention window

1. Open the **Database** tool and select **Production**.
2. Open **Settings**, then expand **Point-in-time recovery** under **Advanced**.
3. Choose a window under **Recovery window**.

![Point-in-time recovery row expanded in the Advanced settings, with the Recovery window set to 7 days](https://mintcdn.com/replit/gkLfQq8l_lg4NsPM/images/databases/data-recovery/pitr-settings.png?fit=max&auto=format&n=gkLfQq8l_lg4NsPM&q=85&s=49c3e1909b69d9036df2c5a91d67e789)

Every plan can pick 6 hours, 12 hours, 1 day, 2 days, 5 days, or 7 days, or choose **Disabled** to turn PITR off. Pro, Teams, and Enterprise can also choose 28 days. A longer window stores more history, which counts toward your storage usage. If you move to Core, any retention window above 7 days is reduced to 7 days.

### [​](https://docs.replit.com/features/data-and-storage/data-recovery\#restore)  Restore

1. In **Point-in-time recovery**, select **Restore database…**.
2. Under **Timestamp**, enter the date and time to go back to. Times are in your local time zone, and the moment must be inside your recovery window.
3. Select **Restore**.

![Restore database dialog with a date and time selected](https://mintcdn.com/replit/gkLfQq8l_lg4NsPM/images/databases/data-recovery/pitr-restore-modal.png?fit=max&auto=format&n=gkLfQq8l_lg4NsPM&q=85&s=a74dff1ca91a3249b81f144efa75dcc8)

The restore replaces the live data with the data as it was at that moment. You can always restore to an earlier point afterward, but not forward, so double-check the timestamp before you confirm. Connected apps reconnect automatically and may see a brief interruption.

Restoring the database doesn’t change your app’s code, and rolling back code doesn’t change production data. To return both to the same moment, restore the database, then [roll back to the matching checkpoint](https://docs.replit.com/features/version-control/checkpoints-and-rollbacks/) and publish again.

## [​](https://docs.replit.com/features/data-and-storage/data-recovery\#schedule-daily-production-backups)  Schedule daily production backups

Scheduled backups take one full snapshot of your production database each day while active and keep it for the period you choose. They’re a lower-cost complement to PITR: fewer restore points, but each one is a complete copy that doesn’t depend on the PITR window.

To reduce storage costs, Neon automatically archives your production database after 24 hours without access. Scheduled backups are skipped while the database is archived. Connecting wakes the database, and backups resume at the next scheduled daily time, not immediately on connection.

An inactivity-related gap alone doesn’t indicate data loss or a failed backup schedule. This behavior doesn’t change your backup retention setting or PITR recovery window. If backups are missing while your database is active, [contact Replit Support](https://replit.com/support).

### [​](https://docs.replit.com/features/data-and-storage/data-recovery\#turn-on-scheduled-backups)  Turn on scheduled backups

1. Open the **Database** tool and select **Production**.
2. Open **Settings**, then expand **Scheduled backups** under **Advanced**.
3. Choose a period under **Keep backups for**. Core supports 7 days; Pro, Teams, and Enterprise can choose 7, 14, or 28 days.

The section shows when the last backup ran.

![Scheduled backups row expanded in the Advanced settings, with Keep backups for set to 7 days and the last backup time](https://mintcdn.com/replit/gkLfQq8l_lg4NsPM/images/databases/data-recovery/backups-settings.png?fit=max&auto=format&n=gkLfQq8l_lg4NsPM&q=85&s=db263e027ee12cb1feb4894ba980e4ef)

Replit schedules the backup near midnight in your browser’s time zone at the time you save. The schedule uses your current UTC offset, so a daylight-saving change can shift it by an hour until you save the setting again.

### [​](https://docs.replit.com/features/data-and-storage/data-recovery\#restore-a-backup)  Restore a backup

1. In **Scheduled backups**, select **View all backups**.
2. Select **Restore** next to the backup you want.
3. Read the warning, type `restore`, and select **Continue**.

![List of daily backups with a Restore button for each](https://mintcdn.com/replit/gkLfQq8l_lg4NsPM/images/databases/data-recovery/backups-view-all.png?fit=max&auto=format&n=gkLfQq8l_lg4NsPM&q=85&s=a7b239f30779d4b5cb4fc0307b879e0d)

![Confirmation dialog asking you to type restore](https://mintcdn.com/replit/gkLfQq8l_lg4NsPM/images/databases/data-recovery/backups-restore-confirm.png?fit=max&auto=format&n=gkLfQq8l_lg4NsPM&q=85&s=bcd4b196a06d8e1efec45870708dfe67)

The restore switches your database to the backup’s data. Your current data isn’t deleted, but getting it back requires help from Replit support, so double-check before restoring. Connected services briefly reconnect.

## [​](https://docs.replit.com/features/data-and-storage/data-recovery\#storage-costs)  Storage costs

Production database storage is metered in three categories. Checkpoint rollback for development databases has no separate charge.

| Storage category | Price per GiB per month |
| --- | --- |
| Database storage | $0.35 |
| Point-in-time recovery history | $0.20 |
| Scheduled backups | $0.09 |

Database storage applies to every production database. PITR history grows with how much your data changes and how long your window is; scheduled backups grow with the number of days kept. If daily restore points are enough for your app, a shorter PITR window plus scheduled backups usually costs less than a long PITR window. See [usage-based billing](https://docs.replit.com/billing/about-usage-based-billing#data-storage) for how storage appears on your bill.

## [​](https://docs.replit.com/features/data-and-storage/data-recovery\#next-steps)  Next steps

- [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production): How your two databases work together.
- [How Publish updates your production database](https://docs.replit.com/features/data-and-storage/publish-database-changes): Review and test schema changes before they reach production.
- [Checkpoints and rollbacks](https://docs.replit.com/features/version-control/checkpoints-and-rollbacks/): Roll your whole app back.
- [Export your production database](https://docs.replit.com/features/data-and-storage/work-with-your-data#export-your-production-database): Download your own copy of your production data.

