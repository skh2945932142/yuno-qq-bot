# AstrBot Deployment Template

This directory is a deployment wrapper for running AstrBot alongside this repository.

What belongs here:

- Docker Compose template
- example environment file
- NapCat connection examples
- notes for wiring AstrBot to Yuno Core

What does not belong here:

- the full AstrBot upstream source tree
- Python virtual environments
- runtime databases, caches, or logs

## Layout

```text
deploy/astrbot/
  docker-compose.yml
  env.example
  README.md
  config/
    astrbot.platform.example.env
    napcat.example.env
  plugins/
    README.md
```

## Quick Start

1. Copy `env.example` to `.env`.
2. Fill in the image tag you actually want to run.
3. Fill in your OpenAI, NapCat, and MongoDB related values.
4. Adjust mount paths in `docker-compose.yml` if your AstrBot image uses different internal directories.
5. Start the stack with `docker compose up -d`.

## Notes

- This repository treats AstrBot as the outer orchestration layer.
- Yuno Core remains the persona and reply engine in `src/`.
- Plugin output should stay structured and flow back through Yuno Core for final wording.
- The compose file here is intentionally a template because AstrBot image names and internal paths can vary by release.
