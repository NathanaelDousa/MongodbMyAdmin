# ==== Config ====
SHELL := /bin/bash

FRONTEND_DIR := mongodbMyAdmin
BACKEND_DIR  := api

HOST          := 127.0.0.1
FRONTEND_PORT := 5173
BACKEND_PORT  := 8000

# Project root als absoluut pad
ROOT_DIR := $(CURDIR)

# Directories voor PID's en logs (absolute paden)
PID_DIR  := $(ROOT_DIR)/.pids
LOG_DIR  := $(ROOT_DIR)/logs

# Bestanden (absolute paden)
BACKEND_PID := $(PID_DIR)/laravel.pid
FRONTEND_PID := $(PID_DIR)/vite.pid
BACKEND_LOG := $(LOG_DIR)/backend.log
FRONTEND_LOG := $(LOG_DIR)/frontend.log

# Vite leest VITE_* env bij start
export VITE_API_URL := http://$(HOST):$(BACKEND_PORT)

.PHONY: install dev frontend backend stop status logs clean-logs build backend-key migrate fresh seed

install:
	@echo "→ Installing backend deps (composer)…"
	cd $(BACKEND_DIR) && composer install
	@echo "→ Installing frontend deps (npm)…"
	cd $(FRONTEND_DIR) && npm install

# Start beide processen in de achtergrond, logs naar files, PID's naar .pids
dev:
	@mkdir -p "$(PID_DIR)" "$(LOG_DIR)"
	@echo "▶ Starting backend (Laravel $(BACKEND_PORT)) …"
	@cd "$(BACKEND_DIR)" && nohup php artisan serve --host=$(HOST) --port=$(BACKEND_PORT) > "$(BACKEND_LOG)" 2>&1 & echo $$! > "$(BACKEND_PID)"
	@echo "  → backend pid: $$(cat "$(BACKEND_PID)")  | log: $(BACKEND_LOG)"
	@echo "▶ Starting frontend (Vite $(FRONTEND_PORT)) …"
	@cd "$(FRONTEND_DIR)" && nohup npm run dev -- --host --port $(FRONTEND_PORT) > "$(FRONTEND_LOG)" 2>&1 & echo $$! > "$(FRONTEND_PID)"
	@echo "  → frontend pid: $$(cat "$(FRONTEND_PID)") | log: $(FRONTEND_LOG)"
	@echo ""
	@echo "✅ Dev servers running."
	@echo "   Frontend: http://$(HOST):$(FRONTEND_PORT)"
	@echo "   Backend : http://$(HOST):$(BACKEND_PORT)"
	@echo ""
	@echo "ℹ️  View logs:   make logs"
	@echo "ℹ️  Stop all:    make stop"

# Los starten (handig voor debug)
backend:
	cd "$(BACKEND_DIR)" && php artisan serve --host=$(HOST) --port=$(BACKEND_PORT)

frontend:
	cd "$(FRONTEND_DIR)" && npm run dev -- --host --port $(FRONTEND_PORT)

# Stoppen op basis van PID files
stop:
	@echo "⏹  Stopping dev servers…"
	@if [ -f "$(FRONTEND_PID)" ]; then \
	  PID=$$(cat "$(FRONTEND_PID)"); \
	  echo " - killing frontend (pid $$PID)"; \
	  kill $$PID 2>/dev/null || true; rm -f "$(FRONTEND_PID)"; \
	else echo " - frontend not running"; fi
	@if [ -f "$(BACKEND_PID)" ]; then \
	  PID=$$(cat "$(BACKEND_PID)"); \
	  echo " - killing backend  (pid $$PID)"; \
	  kill $$PID 2>/dev/null || true; rm -f "$(BACKEND_PID)"; \
	else echo " - backend not running"; fi
	@echo "✅ Done."

status:
	@echo "🩺 Status"
	@if [ -f "$(BACKEND_PID)" ]; then echo " - backend pid:  $$(cat "$(BACKEND_PID)")"; else echo " - backend:  not running"; fi
	@if [ -f "$(FRONTEND_PID)" ]; then echo " - frontend pid: $$(cat "$(FRONTEND_PID)")"; else echo " - frontend: not running"; fi

logs:
	@mkdir -p "$(LOG_DIR)"
	@echo "🪵 Tailing logs (Ctrl-C to exit)…"
	@touch "$(BACKEND_LOG)" "$(FRONTEND_LOG)"
	@tail -n 50 -f "$(BACKEND_LOG)" "$(FRONTEND_LOG)"

clean-logs:
	@rm -f "$(BACKEND_LOG)" "$(FRONTEND_LOG)"
	@echo "🧹 Logs removed."

# Prod build (frontend)
build:
	cd "$(FRONTEND_DIR)" && npm run build

# Laravel helpers
backend-key:
	cd "$(BACKEND_DIR)" && php artisan key:generate

migrate:
	cd "$(BACKEND_DIR)" && php artisan migrate

fresh:
	cd "$(BACKEND_DIR)" && php artisan migrate:fresh --seed

seed:
	cd "$(BACKEND_DIR)" && php artisan db:seed