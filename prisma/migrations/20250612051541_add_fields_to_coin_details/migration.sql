-- AlterTable
ALTER TABLE "cg_coin_details" ADD COLUMN     "links_subreddit_url" TEXT,
ADD COLUMN     "sentiment_votes_up_percentage" DOUBLE PRECISION,
ADD COLUMN     "watchlist_portfolio_users" INTEGER;
