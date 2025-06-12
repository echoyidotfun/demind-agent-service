/*
  Warnings:

  - You are about to drop the column `listAt` on the `Protocol` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Protocol" DROP COLUMN "listAt",
ADD COLUMN     "listedAt" TIMESTAMP(3);
