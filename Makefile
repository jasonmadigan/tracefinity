.PHONY: dev

dev:
	@trap 'kill 0' EXIT; \
	(cd backend && . venv/bin/activate && uvicorn app.main:app --reload --port 8000) & \
	(cd frontend && npm run dev) & \
	wait
