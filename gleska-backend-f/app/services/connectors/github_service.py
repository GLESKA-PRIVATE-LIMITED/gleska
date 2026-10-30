"""GitHub connector — candidate portfolio retrieval."""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


class GitHubService:
    """Fetch GitHub profiles and repositories through the AI Assistant.

    GitHub public API does not require authentication for basic profile data,
    though rate limits are lower without a token.
    """

    @staticmethod
    async def fetch_portfolio(username: str) -> dict[str, Any]:
        username = username.strip().lstrip("@")
        if not username:
            return {"found": False, "error": "GitHub username is required."}

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "GLESKA-HiringAgent/1.0",
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                user_resp = await client.get(f"{GITHUB_API_BASE}/users/{username}", headers=headers)

                if user_resp.status_code == 404:
                    return {"found": False, "error": f"GitHub user '{username}' not found."}
                if user_resp.status_code != 200:
                    return {"found": False, "error": f"GitHub API returned status {user_resp.status_code}."}

                user_data = user_resp.json()

                repos_resp = await client.get(
                    f"{GITHUB_API_BASE}/users/{username}/repos",
                    params={"sort": "updated", "per_page": 10, "type": "owner"},
                    headers=headers,
                )

                repositories: list[dict[str, Any]] = []
                language_counts: dict[str, int] = {}

                if repos_resp.status_code == 200:
                    for repo in repos_resp.json():
                        repositories.append({
                            "name": repo.get("name", ""),
                            "description": repo.get("description") or "",
                            "language": repo.get("language") or "",
                            "stars": repo.get("stargazers_count", 0),
                            "forks": repo.get("forks_count", 0),
                            "updated_at": repo.get("updated_at", ""),
                        })
                        lang = repo.get("language")
                        if lang:
                            language_counts[lang] = language_counts.get(lang, 0) + 1

                top_languages = sorted(language_counts, key=language_counts.get, reverse=True)[:5]  # type: ignore[arg-type]

                return {
                    "found": True,
                    "name": user_data.get("name") or username,
                    "bio": user_data.get("bio") or "",
                    "public_repos": user_data.get("public_repos", 0),
                    "followers": user_data.get("followers", 0),
                    "top_languages": top_languages,
                    "repositories": repositories,
                }

        except httpx.TimeoutException:
            return {"found": False, "error": "GitHub service timed out."}
        except httpx.HTTPError:
            return {"found": False, "error": "GitHub service connection error."}
