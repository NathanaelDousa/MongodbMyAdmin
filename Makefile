# ==== Config ====
SHELL := /bin/bash

FRONTEND_DIR := mongodbMyAdmin
BACKEND_DIR  := api

HOST          := 127.0.0.1
FRONTEND_PORT := 5173
BACKEND_PORT  := 8000

# Vite reads VITE_* env at start in.
export VITE_API_URL := http://$(HOST):$(BACKEND_PORT)

# ==== Paths (absolute so subshell cd's don't matter) ====
PID_DIR := $(abspath .pids)
LOG_DIR := $(abspath .logs)

# ==== Helpers ====
.PHONY: install dev frontend backend stop build backend-key migrate fresh seed status logs clean-logs

install:
	@mkdir -p $(PID_DIR) $(LOG_DIR)
	@echo "→ Installing backend deps (composer)…"
	cd $(BACKEND_DIR) && composer install
	@echo "→ Installing frontend deps (npm)…"
	cd $(FRONTEND_DIR) && npm install
	@echo "✓ Install complete."

# Dev: start beide processen met vaste poorten + stille logs + PID files
dev:
	@mkdir -p $(PID_DIR) $(LOG_DIR)
	@echo "▶ Starting backend (Laravel $(BACKEND_PORT)) …"
	@set -euo pipefail; \
	( cd $(BACKEND_DIR) && \
	  php artisan serve --host=$(HOST) --port=$(BACKEND_PORT) \
	    >"$(LOG_DIR)/laravel.log" 2>&1 & echo $$! >"$(PID_DIR)/laravel.pid" ); \
	sleep 0.3; \
	echo "▶ Starting frontend (Vite $(FRONTEND_PORT)) …"; \
	( cd $(FRONTEND_DIR) && \
	  npm run dev -- --host --port $(FRONTEND_PORT) --strictPort \
	    >"$(LOG_DIR)/vite.log" 2>&1 & echo $$! >"$(PID_DIR)/vite.pid" ); \
	echo ""; \
	echo "→ Backend:  http://$(HOST):$(BACKEND_PORT)   (logs: $(LOG_DIR)/laravel.log)"; \
	echo "→ Frontend: http://$(HOST):$(FRONTEND_PORT) (logs: $(LOG_DIR)/vite.log)"; \
	echo "Press Ctrl+C to stop (or run: make stop)"; \
	trap ' \
	  echo; echo "⏹  Stopping dev servers…"; \
	  ( test -f "$(PID_DIR)/laravel.pid" && kill $$(cat "$(PID_DIR)/laravel.pid") 2>/dev/null || true ); \
	  ( test -f "$(PID_DIR)/vite.pid"    && kill $$(cat "$(PID_DIR)/vite.pid")    2>/dev/null || true ); \
	  rm -f "$(PID_DIR)/laravel.pid" "$(PID_DIR)/vite.pid"; \
	' INT TERM; \
	wait

# Los starten (met vaste poorten)
backend:
	mkdir -p $(PID_DIR) $(LOG_DIR)
	cd $(BACKEND_DIR) && php artisan serve --host=$(HOST) --port=$(BACKEND_PORT)

frontend:
	mkdir -p $(PID_DIR) $(LOG_DIR)
	cd $(FRONTEND_DIR) && npm run dev -- --host=$(HOST) --port=$(FRONTEND_PORT) --strictPort

# Prod build (frontend)
build:
	cd $(FRONTEND_DIR) && npm run build

# Laravel QoL
backend-key:
	cd $(BACKEND_DIR) && php artisan key:generate
migrate:
	cd $(BACKEND_DIR) && php artisan migrate
fresh:
	cd $(BACKEND_DIR) && php artisan migrate:fresh --seed
seed:
	cd $(BACKEND_DIR) && php artisan db:seed

# Proces status
status:
	@echo "— Status —"
	@printf "Backend PID:  "; (test -f "$(PID_DIR)/laravel.pid" && cat "$(PID_DIR)/laravel.pid" || echo "(none)")
	@printf "Frontend PID: "; (test -f "$(PID_DIR)/vite.pid"    && cat "$(PID_DIR)/vite.pid"    || echo "(none)")
	@echo
	@echo "Listening ports:"
	@-command -v lsof >/dev/null 2>&1 && lsof -iTCP -sTCP:LISTEN -nP | egrep ':($(BACKEND_PORT)|$(FRONTEND_PORT))\b' || echo "lsof not available"

# Logs
logs:
	@echo "— Tail logs — (Ctrl-C to stop)"
	@mkdir -p $(LOG_DIR)
	@touch "$(LOG_DIR)/laravel.log" "$(LOG_DIR)/vite.log"
	@tail -n +1 -f "$(LOG_DIR)/laravel.log" "$(LOG_DIR)/vite.log"

clean-logs:
	@rm -f "$(LOG_DIR)/laravel.log" "$(LOG_DIR)/vite.log"
	@echo "✓ Logs cleared."

stop:
	@echo "⏹ Stopping dev servers…"
	-@[ -f "$(PID_DIR)/laravel.pid" ] && kill -TERM `cat "$(PID_DIR)/laravel.pid"` 2>/dev/null || true
	-@[ -f "$(PID_DIR)/vite.pid" ]    && kill -TERM `cat "$(PID_DIR)/vite.pid"`    2>/dev/null || true
	-@pkill -f "php artisan serve --host=$(HOST) --port=$(BACKEND_PORT)" 2>/dev/null || true
	-@pkill -f "vite.*$(FRONTEND_DIR)" 2>/dev/null || true
	-@command -v lsof >/dev/null 2>&1 && lsof -ti tcp:$(BACKEND_PORT)  | xargs -r kill -TERM || true
	-@command -v lsof >/dev/null 2>&1 && lsof -ti tcp:$(FRONTEND_PORT) | xargs -r kill -TERM || true
	-@rm -f "$(PID_DIR)/laravel.pid" "$(PID_DIR)/vite.pid"
	@echo "✓ Stopped."
	# Restart (stop + dev)
	
# Restart (stop + dev)
restart: stop dev