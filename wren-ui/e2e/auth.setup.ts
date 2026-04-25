import fs from 'fs';
import path from 'path';
import { test as setup, expect } from '@playwright/test';
import {
  ensureMutableRuntimeScopeForUser,
  loginAsDefaultOwner,
} from './helper';

const authStatePath = path.join(__dirname, '.auth', 'user.json');
const RUNTIME_SCOPE_STORAGE_KEY = 'wren.runtimeScope';
const E2E_OWNER_EMAIL = 'admin@example.com';

setup('authenticate default owner', async ({ page }) => {
  fs.mkdirSync(path.dirname(authStatePath), { recursive: true });

  await loginAsDefaultOwner(page);
  await page.goto('/home');
  await expect(page).toHaveURL(/\/home(?:\?.*)?$/, {
    timeout: 60_000,
  });

  const selector = await ensureMutableRuntimeScopeForUser({
    email: E2E_OWNER_EMAIL,
  });

  await page.evaluate(
    ({ runtimeScopeStorageKey, nextSelector }) => {
      window.localStorage.setItem(
        runtimeScopeStorageKey,
        JSON.stringify(nextSelector),
      );
    },
    {
      runtimeScopeStorageKey: RUNTIME_SCOPE_STORAGE_KEY,
      nextSelector: selector,
    },
  );

  await page.goto(
    `/home?workspaceId=${selector.workspaceId}&knowledgeBaseId=${selector.knowledgeBaseId}`,
  );
  await expect(page).toHaveURL(/\/home(?:\?.*)?$/, {
    timeout: 60_000,
  });
  await page.context().storageState({ path: authStatePath });
});
