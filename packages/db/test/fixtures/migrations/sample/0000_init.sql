CREATE SCHEMA "sample";
--> statement-breakpoint
CREATE TABLE "sample"."widgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
