import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Fluxo real de conta: cadastro → perfil → sair → login → perfil.
const BASE = 'http://127.0.0.1:3000';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.refs', 'shots');
mkdirSync(SHOTS, { recursive: true });
const fails = [];
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const email = `teste${Date.now()}@bereree.com`;
const senha = 'senha-segura-123';

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.locator('.splash').waitFor({ state: 'hidden', timeout: 9000 }).catch(() => {});

// As duas opções existem na tela de boas-vindas
const welcomeLinks = await page.locator('.welcome-copy a').allTextContents();
ok('boas-vindas oferece começar e entrar', welcomeLinks.some(t => /Começar/i.test(t)) && welcomeLinks.some(t => /Já tenho acesso/i.test(t)), welcomeLinks.join(' | '));

// --- Cadastro ---
await page.getByRole('link', { name: /Começar/i }).click();
await page.waitForURL('**/cadastro');
await page.fill('input[name="nome"]', 'Teste Berêrê');
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', senha);
await page.screenshot({ path: `${SHOTS}/5-cadastro.png` });
await page.getByRole('button', { name: /Criar conta/i }).click();
await page.waitForSelector('.market-home', { timeout: 10000 });
ok('cadastro cria a conta e entra na loja', page.url().endsWith('/'));

// Perfil mostra o usuário
await page.goto(BASE + '/perfil');
await page.waitForSelector('.profile-hero', { timeout: 8000 });
const hero = await page.locator('.profile-hero').textContent();
ok('perfil reconhece a conta criada', hero.includes('Teste'), hero.slice(0, 60));
await page.screenshot({ path: `${SHOTS}/6-perfil-logado.png` });

// --- Sair ---
await page.getByRole('button', { name: /Sair da conta/i }).click();
await page.waitForSelector('.profile-hero', { timeout: 8000 });
const heroAfter = await page.locator('.profile-hero').textContent();
ok('logout desloga de verdade', heroAfter.includes('Entre para acessar') || !heroAfter.includes('Teste'), heroAfter.slice(0, 80));

// --- Login com erro de senha (mensagem clara) ---
await page.goto(BASE + '/login');
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', 'senha-errada-999');
await page.getByRole('button', { name: /^Entrar$/ }).click();
await page.waitForSelector('.form-error', { timeout: 8000 });
const errMsg = await page.locator('.form-error').textContent();
ok('senha errada mostra erro claro', /inválidos|senha|e-mail/i.test(errMsg), errMsg);

// --- Login correto ---
await page.fill('input[name="password"]', senha);
await page.screenshot({ path: `${SHOTS}/7-login.png` });
await page.getByRole('button', { name: /^Entrar$/ }).click();
await page.waitForSelector('.market-home', { timeout: 10000 });
await page.goto(BASE + '/perfil');
await page.waitForSelector('.profile-hero', { timeout: 8000 });
const hero2 = await page.locator('.profile-hero').textContent();
ok('login com sucesso volta para a conta', hero2.includes('Teste'), hero2.slice(0, 60));

await browser.close();
console.log(fails.length ? `\nFALHAS: ${fails.join(' ; ')}` : '\nTUDO OK');
process.exit(fails.length ? 1 : 0);
