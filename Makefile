.PHONY: install dev build test test-run coverage lint clean help

# Default target
all: build

# Install dependencies
install:
	npm install

# Run dev environment
dev:
	npm run dev

# Build the project
build:
	npm run build

# Run tests in watch mode
test:
	npm run test

# Run tests once
test-run:
	npm run test:run

# Run tests with coverage
coverage:
	npm run test:coverage

# Lint code
lint:
	npm run lint

# Clean build artifacts
clean:
	rm -rf dist coverage

# Help menu
help:
	@echo "Available commands:"
	@echo "  make install    - Install project dependencies"
	@echo "  make dev        - Run project in development mode"
	@echo "  make build      - Build the TypeScript project"
	@echo "  make test       - Run unit tests in watch mode"
	@echo "  make test-run   - Run unit tests once"
	@echo "  make coverage   - Run unit tests and generate coverage report"
	@echo "  make lint       - Run linter"
	@echo "  make clean      - Remove build and coverage output directories"
