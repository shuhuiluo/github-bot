export interface GitHubUser {
  login: string;
  [key: string]: any;
}

export interface GitHubLabel {
  name: string;
  color?: string;
  [key: string]: any;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: GitHubUser;
  comments: number;
  labels: GitHubLabel[];
  html_url: string;
  [key: string]: any;
}

export interface GitHubPullRequest extends GitHubIssue {
  merged: boolean;
  additions: number;
  deletions: number;
  [key: string]: any;
}
