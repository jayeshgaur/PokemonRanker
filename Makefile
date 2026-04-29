.PHONY: help install api web typecheck lint test all clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install JS deps and tidy Go modules
	pnpm install
	cd apps/api && go mod tidy

web: ## Run the Next.js dev server (the web app is the deployable per D-22)
	pnpm --filter @pokemon-ranker/web dev

sync: ## Build the Pokédex SQLite. Pass APIDATA=path or run `make sync-from-clone` once 1.B.2 lands.
	cd apps/api && go run ./cmd/pokedex-sync bulk --out data/pokedex.sqlite $(if $(APIDATA),--api-data $(APIDATA))

sync-from-clone: api-data-pull ## Pull api-data and build the SQLite from it (one-shot)
	cd apps/api && go run ./cmd/pokedex-sync bulk --out data/pokedex.sqlite --api-data data/api-data

api-data-pull: ## Clone or update PokeAPI/api-data (~557 MB shallow clone)
	@if [ -d apps/api/data/api-data/.git ]; then \
		echo "Updating apps/api/data/api-data..."; \
		cd apps/api/data/api-data && git fetch --depth 1 origin master && git reset --hard origin/master; \
	else \
		echo "Cloning PokeAPI/api-data into apps/api/data/api-data (one-time, ~557 MB)..."; \
		mkdir -p apps/api/data; \
		git clone --depth 1 --branch master --single-branch https://github.com/PokeAPI/api-data.git apps/api/data/api-data; \
	fi

sync-validate: ## Run post-sync data sanity-check suite against the local SQLite
	cd apps/api && go run ./cmd/pokedex-sync validate --db data/pokedex.sqlite

publish-db: ## Copy the freshly-built SQLite into apps/web/data for Vercel deploy
	@if [ ! -f apps/api/data/pokedex.sqlite ]; then echo "Run 'make sync-from-clone' first."; exit 1; fi
	mkdir -p apps/web/data
	cp apps/api/data/pokedex.sqlite apps/web/data/pokedex.sqlite
	@echo "Published $$(du -h apps/web/data/pokedex.sqlite | awk '{print $$1}') SQLite to apps/web/data/. Commit and push to redeploy."

sync-inspect: ## Show row counts, latest sync_meta, and sample rows from the local SQLite
	@if [ ! -f apps/api/data/pokedex.sqlite ]; then echo "Run 'make sync' first."; exit 1; fi
	@echo "=== Row counts ==="
	@for tbl in $$(sqlite3 apps/api/data/pokedex.sqlite "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"); do \
		count=$$(sqlite3 apps/api/data/pokedex.sqlite "SELECT COUNT(*) FROM $$tbl;"); \
		printf "  %-22s %8d\n" "$$tbl" "$$count"; \
	done
	@echo
	@echo "=== Latest sync_meta ==="
	@sqlite3 -header -column apps/api/data/pokedex.sqlite "SELECT id, ran_at, mode, api_data_commit_sha, duration_ms, status FROM sync_meta ORDER BY id DESC LIMIT 1;"
	@echo
	@echo "=== Sample pokemon (first 5) ==="
	@sqlite3 -header -column apps/api/data/pokedex.sqlite "SELECT id, slug, display_name, generation_id FROM pokemon LIMIT 5;"
	@echo
	@echo "=== api-data SHA pin ==="
	@if [ -f apps/api/data/api-data-sha ]; then cat apps/api/data/api-data-sha; else echo "  (not pinned — sync hasn't seen a real api-data checkout yet)"; fi

typecheck: ## Typecheck Go (sync binary) and TS (web app)
	cd apps/api && go vet ./...
	pnpm -r typecheck

lint: ## Lint Go (sync binary) and TS (web app)
	cd apps/api && golangci-lint run
	pnpm -r lint

test: ## Run Go (sync binary) and TS (web app) test suites
	cd apps/api && go test ./...
	pnpm -r test

all: typecheck lint test ## Run all checks

clean: ## Remove generated artifacts
	rm -rf apps/web/.next apps/web/out apps/api/bin apps/api/tmp coverage
