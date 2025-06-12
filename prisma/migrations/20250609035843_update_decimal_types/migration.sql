/*
  Warnings:

  - Made the column `apy` on table `Pool` required. This step will fail if there are existing NULL values in that column.
  - Made the column `stablecoin` on table `Pool` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ilRisk` on table `Pool` required. This step will fail if there are existing NULL values in that column.
  - Made the column `exposure` on table `Pool` required. This step will fail if there are existing NULL values in that column.
  - Made the column `chain` on table `Protocol` required. This step will fail if there are existing NULL values in that column.
  - Made the column `logo` on table `Protocol` required. This step will fail if there are existing NULL values in that column.
  - Made the column `category` on table `Protocol` required. This step will fail if there are existing NULL values in that column.
  - Made the column `url` on table `Protocol` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Pool" ALTER COLUMN "apy" SET NOT NULL,
ALTER COLUMN "stablecoin" SET NOT NULL,
ALTER COLUMN "ilRisk" SET NOT NULL,
ALTER COLUMN "exposure" SET NOT NULL;

-- AlterTable
ALTER TABLE "Protocol" ALTER COLUMN "chain" SET NOT NULL,
ALTER COLUMN "logo" SET NOT NULL,
ALTER COLUMN "category" SET NOT NULL,
ALTER COLUMN "url" SET NOT NULL;
