-- CreateTable
CREATE TABLE "cg_coins_index" (
    "cg_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cg_coins_index_pkey" PRIMARY KEY ("cg_id")
);

-- CreateTable
CREATE TABLE "cg_coin_platforms" (
    "id" SERIAL NOT NULL,
    "cg_id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "contract_address" TEXT NOT NULL,

    CONSTRAINT "cg_coin_platforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cg_coin_details" (
    "cg_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "asset_platform_id" TEXT,
    "description_en" TEXT,
    "image_thumb_url" TEXT,
    "image_small_url" TEXT,
    "image_large_url" TEXT,
    "categories" JSONB,
    "links_homepage" TEXT,
    "links_whitepaper_url" TEXT,
    "links_twitter_screen_name" TEXT,
    "links_telegram_channel_identifier" TEXT,
    "links_github_repos" TEXT,
    "market_cap_rank" INTEGER,
    "current_price_usd" DECIMAL(65,30),
    "market_cap_usd" DECIMAL(65,30),
    "fully_diluted_valuation_usd" DECIMAL(65,30),
    "total_volume_usd" DECIMAL(65,30),
    "ath_usd" DECIMAL(65,30),
    "ath_date_usd" TIMESTAMP(3),
    "atl_usd" DECIMAL(65,30),
    "atl_date_usd" TIMESTAMP(3),
    "circulating_supply" DECIMAL(65,30),
    "total_supply" DECIMAL(65,30),
    "max_supply" DECIMAL(65,30),
    "price_change_percentage_24h_usd" DECIMAL(65,30),
    "price_change_percentage_7d_usd" DECIMAL(65,30),
    "price_change_percentage_14d_usd" DECIMAL(65,30),
    "price_change_percentage_30d_usd" DECIMAL(65,30),
    "price_change_percentage_60d_usd" DECIMAL(65,30),
    "price_change_percentage_200d_usd" DECIMAL(65,30),
    "price_change_percentage_1y_usd" DECIMAL(65,30),
    "cg_last_updated" TIMESTAMP(3),
    "data_fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cg_coin_details_pkey" PRIMARY KEY ("cg_id")
);

-- CreateIndex
CREATE INDEX "cg_coin_platforms_platform_id_contract_address_idx" ON "cg_coin_platforms"("platform_id", "contract_address");

-- CreateIndex
CREATE UNIQUE INDEX "cg_coin_platforms_cg_id_platform_id_contract_address_key" ON "cg_coin_platforms"("cg_id", "platform_id", "contract_address");

-- AddForeignKey
ALTER TABLE "cg_coin_platforms" ADD CONSTRAINT "cg_coin_platforms_cg_id_fkey" FOREIGN KEY ("cg_id") REFERENCES "cg_coins_index"("cg_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cg_coin_details" ADD CONSTRAINT "cg_coin_details_cg_id_fkey" FOREIGN KEY ("cg_id") REFERENCES "cg_coins_index"("cg_id") ON DELETE RESTRICT ON UPDATE CASCADE;
