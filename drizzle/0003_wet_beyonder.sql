CREATE TABLE "pending_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"towns_user_id" text NOT NULL,
	"space_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"event_types" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_subscriptions" ADD CONSTRAINT "pending_subscriptions_towns_user_id_github_user_tokens_towns_user_id_fk" FOREIGN KEY ("towns_user_id") REFERENCES "public"."github_user_tokens"("towns_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pending_subscriptions_expires" ON "pending_subscriptions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_pending_subscriptions_user" ON "pending_subscriptions" USING btree ("towns_user_id");--> statement-breakpoint
CREATE INDEX "idx_pending_subscriptions_repo" ON "pending_subscriptions" USING btree ("repo_full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_subscriptions_unique_idx" ON "pending_subscriptions" USING btree ("space_id","channel_id","repo_full_name");