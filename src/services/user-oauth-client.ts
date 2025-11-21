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
 * UserOAuthClient - User OAuth-authenticated GitHub API calls
 *
 * Provides methods for validating repositories, checking permissions,
 * and getting user profile data using user OAuth tokens.
 */
export class UserOAuthClient {
  /**
   * Validate repository and get metadata using user's OAuth token
   * @param token - User's GitHub OAuth access token
   * @param owner - Repository owner (user or org)
   * @param repo - Repository name
   * @returns Repository metadata
   * @throws Error if repo not found or user has no access (404/403)
   */
  async validateRepository(
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
      if ((error as any)?.status === 404 || (error as any)?.status === 403) {
        throw new Error(
          `Repository not found or you don't have access: ${owner}/${repo}`
        );
      }
      throw error;
    }
  }

  /**
   * Get authenticated user's profile
   * @param token - User's GitHub OAuth access token
   * @returns User profile with id and login
   */
  async getUserProfile(token: string): Promise<UserProfile> {
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.users.getAuthenticated();

    return {
      id: data.id,
      login: data.login,
    };
  }
}
