# Git Branching & Workflow Rules

1. **Originating Branch**: Always create new feature, issue, or epic branches directly off `main` (`git checkout main && git pull origin main && git checkout -b <branch-name>`), unless explicitly instructed otherwise by the user.
2. **Branch Isolation**: Never branch off an unmerged feature branch or carry over uncommitted work from another task into a new branch.
