# Security policy

Aegis is a portfolio and learning project, not a hardened production product. See the website's Security page and
the "Honest scope" section of the README for the threat model and known limits.

To report a vulnerability, email sriramojunikhil66@gmail.com with steps to reproduce. Please do not open a public issue
for security problems. Never commit API keys: `.env` is git-ignored, and a key that leaks must be revoked at the provider.
