-- CreateTable
CREATE TABLE "Protocol" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "symbol" TEXT,
    "description" TEXT,
    "chain" TEXT,
    "logo" TEXT,
    "audits" TEXT,
    "category" TEXT,
    "chains" TEXT[],
    "tvl" DOUBLE PRECISION,
    "change_1h" DOUBLE PRECISION,
    "change_1d" DOUBLE PRECISION,
    "change_7d" DOUBLE PRECISION,
    "mcap" DOUBLE PRECISION,
    "twitter" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audit_links" TEXT[],
    "github" TEXT,

    CONSTRAINT "Protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "tvlUsd" DOUBLE PRECISION NOT NULL,
    "apyBase" DOUBLE PRECISION,
    "apyReward" DOUBLE PRECISION,
    "apy" DOUBLE PRECISION,
    "rewardTokens" TEXT,
    "stablecoin" BOOLEAN,
    "ilRisk" TEXT,
    "exposure" TEXT,
    "poolMeta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolToken" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolChart" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "tvlUsd" DOUBLE PRECISION NOT NULL,
    "apy" DOUBLE PRECISION,
    "apyBase" DOUBLE PRECISION,
    "apyReward" DOUBLE PRECISION,

    CONSTRAINT "PoolChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stablecoin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "geckoId" TEXT,
    "pegType" TEXT NOT NULL,
    "pegMechanism" TEXT,
    "circulating" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "chains" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stablecoin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Protocol_slug_key" ON "Protocol"("slug");

-- CreateIndex
CREATE INDEX "Protocol_category_idx" ON "Protocol"("category");

-- CreateIndex
CREATE INDEX "Protocol_slug_idx" ON "Protocol"("slug");

-- CreateIndex
CREATE INDEX "Pool_project_idx" ON "Pool"("project");

-- CreateIndex
CREATE INDEX "Pool_chain_idx" ON "Pool"("chain");

-- CreateIndex
CREATE INDEX "Pool_apy_idx" ON "Pool"("apy");

-- CreateIndex
CREATE INDEX "PoolToken_tokenAddress_idx" ON "PoolToken"("tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "PoolToken_poolId_tokenAddress_key" ON "PoolToken"("poolId", "tokenAddress");

-- CreateIndex
CREATE INDEX "PoolChart_poolId_timestamp_idx" ON "PoolChart"("poolId", "timestamp");

-- CreateIndex
CREATE INDEX "Stablecoin_symbol_idx" ON "Stablecoin"("symbol");

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_project_fkey" FOREIGN KEY ("project") REFERENCES "Protocol"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolToken" ADD CONSTRAINT "PoolToken_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolChart" ADD CONSTRAINT "PoolChart_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
