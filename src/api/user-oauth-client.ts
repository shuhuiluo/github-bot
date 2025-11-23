import { Octokit } from "@octokit/rest";

/**
 * Repository metadata from GitHub API
 */
export interface RepositoryInfo {
  fullName: string; // Normalized "owner/repo"
  isPrivate: boolean;
  owner: {
    login: string; // Account name
    type: "User" | "Organization";
    id: number; // Numeric ID for installation links
  };
}

/**
 * GitHub user profile
 */
export interface UserProfile {
  id: number;
  login: string;
}

/**
 * Validate repository and get metadata using user's OAuth token
 * @param token - User's GitHub OAuth access token
 * @param owner - Repository owner (user or org)
 * @param repo - Repository name
 * @returns Repository metadata
 * @throws Error if repo not found or user has no access (404/403)
 */
export async function validateRepository(
  token: string,
  owner: string,
  repo: string
): Promise<RepositoryInfo> {
  const octokit = new Octokit({ auth: token });

  try {
    const { data } = await octokit.repos.get({
      owner,
      repo,
    });

    return {
      fullName: data.full_name,
      isPrivate: data.private,
      owner: {
        login: data.owner.login,
        type: data.owner.type as "User" | "Organization",
        id: data.owner.id,
      },
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const status = (error as any)?.status;

    if (status === 404) {
      throw new Error(
        `Repository not found or you don't have access to ${owner}/${repo}`,
        { cause: error }
      );
    }

    if (status === 403) {
      // 403 often means org hasn't approved the GitHub App
      throw new Error(
        `Access denied to ${owner}/${repo}. If this is a private organization repository, ` +
          `the organization admin may need to approve this GitHub App in GitHub settings.`,
        { cause: error }
      );
    }

    throw error;
  }
}

/**
 * Get authenticated user's profile
 * @param token - User's GitHub OAuth access token
 * @returns User profile with id and login
 * @throws Error if token is invalid or expired
 */
export async function getUserProfile(token: string): Promise<UserProfile> {
  const octokit = new Octokit({ auth: token });

  try {
    const { data } = await octokit.users.getAuthenticated();

    return {
      id: data.id,
      login: data.login,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if ((error as any)?.status === 401) {
      throw new Error("GitHub token is invalid or expired", { cause: error });
    }
    throw error;
  }
}

/**
 * Get owner ID from username or org using user's OAuth token
 * Fetches public profile - works even without repo access
 * @param token - User's GitHub OAuth access token
 * @param owner - Repository owner username or org name
 * @returns Owner ID or undefined if lookup fails
 */
export async function getOwnerIdFromUsername(
  token: string,
  owner: string
): Promise<number | undefined> {
  try {
    const octokit = new Octokit({ auth: token });

    // Try as organization first (most private repos are in orgs)
    try {
      const { data } = await octokit.orgs.get({ org: owner });
      return data.id;
    } catch {
      // If not org, try as user
      const { data } = await octokit.users.getByUsername({
        username: owner,
      });
      return data.id;
    }
  } catch (error) {
    console.warn(`Could not fetch owner ID for ${owner}:`, error);
    return undefined; // Fallback: omit target_id
  }
}
