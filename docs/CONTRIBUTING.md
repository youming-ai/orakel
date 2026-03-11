# Contributing to Orakel

Thank you for your interest in the Orakel project! We welcome contributions in all forms, including but not limited to bug fixes, feature development, and documentation improvements.

## How to Contribute

### 1. Report Issues

If you find a bug or have a feature suggestion, please first search [Issues](https://github.com/youming-ai/orakel/issues) to see if it already exists. If not, please create a new Issue with the following information:

- **Bug Report**: Reproduction steps, expected behavior, actual behavior, environment info
- **Feature Request**: Detailed feature description, use cases, possible implementation

### 2. Submit Code

1. **Fork** this repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a **Pull Request**

### 3. Development Environment Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/orakel.git
cd orakel

# Install dependencies (all packages)
bun install

# Create feature branch
git checkout -b feature/your-feature
```

### 4. Code Standards

- Use **TypeScript** for development
- Run type check: `bun run typecheck`
- Follow existing project code style
- Add necessary comments and documentation

### 5. Pull Request Guidelines

- PR title should clearly describe what the PR does
- Description should include:
  - Problem being solved or feature being added
  - Changes involved
  - Test results (if applicable)
- Ensure all tests pass

## Project Structure

```
orakel/
├── packages/
│   ├── shared/       # @orakel/shared — Shared types and contracts
│   ├── bot/          # @orakel/bot — Trading bot backend
│   │   ├── src/
│   │   │   ├── engines/      # Trading strategy engines
│   │   │   ├── indicators/   # Technical indicators
│   │   │   ├── data/         # Data sources (Binance, Polymarket, Chainlink)
│   │   │   ├── trading/      # Trade execution
│   │   │   ├── pipeline/     # Market data processing
│   │   │   └── __tests__/    # Test files
│   │   └── scripts/          # Utility scripts
│   └── web/          # @orakel/web — Frontend dashboard (Vite + React)
├── data/             # Runtime data
├── drizzle/          # Database migrations
└── config.json       # Strategy configuration
```

## Tech Stack

- **Backend**: Bun, TypeScript, Hono, Drizzle ORM, PostgreSQL, ethers
- **Frontend**: Vite, React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, Zustand
- **Blockchain**: Polygon, Polymarket CLOB
- **Deployment**: Docker (VPS), Cloudflare Workers (frontend)

## License

By contributing code, you agree that your contributions will be released under the [MIT License](LICENSE).

---

Feel free to submit Issues or join discussions!
