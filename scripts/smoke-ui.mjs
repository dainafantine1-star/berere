import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Smoke visual: splash digitado → boas-vindas → home com identidade Berêrê → popups.
const BASE = 'http://127.0.0.1:3000';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.refs', 'shots');
const MARINHA = 'rgb(16, 31, 112)';
const AMARELO_CLARO = 'rgb(255, 248, 204)';
mkdirSync(SHOTS, { recursive: true });
const fails = [];
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails.push(label);
};
const assertCss = async (page, label, selector, prop, expected) => {
  const value = await page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop).catch(() => '');
  ok(label, value === expected, `${value} (esperado ${expected})`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

// 1) Splash presente e digitando
const splash = page.locator('.splash');
await splash.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
ok('splash aparece na entrada', await splash.isVisible());
const mid = await page.locator('.splash-name').textContent().catch(() => '');
ok('splash está digitando o nome', !!mid && 'BERÊRÊ'.startsWith(mid.trim()), `texto parcial: "${mid}"`);
await page.screenshot({ path: `${SHOTS}/1-splash.png` });

// 2) Splash termina sozinho e libera a navegação
await splash.waitFor({ state: 'hidden', timeout: 9000 }).catch(() => {});
ok('splash some sozinho', !(await splash.isVisible()));
const flag = await page.evaluate(() => sessionStorage.getItem('bereree-splash'));
ok('bandeira de sessão do splash gravada', flag === '1');

// 3) Boas-vindas (primeira visita)
await page.waitForTimeout(400);
const welcome = await page.locator('.welcome-copy h1').textContent().catch(() => '');
ok('boas-vindas renderiza', welcome.includes('mercado'), `h1: "${welcome}"`);
await assertCss(page, 'boas-vindas em azul-marinho', '.welcome-visual', 'backgroundColor', MARINHA);
await page.screenshot({ path: `${SHOTS}/2-boas-vindas.png` });

// 4) Entra como visitante → home
await page.getByRole('button', { name: /Continuar como visitante/i }).click();
await page.waitForSelector('.market-home', { timeout: 8000 });
const h2s = await page.locator('.market-home .section-heading h2').allTextContents();
ok('seções da home', h2s.includes('Ofertas da semana') && h2s.includes('Populares por aqui'), h2s.join(' | '));

// 5) Identidade nos elementos-chave
await assertCss(page, 'botão adicionar marinho', '.market-product .add-button', 'backgroundColor', MARINHA);
await assertCss(page, 'selo "Ver mais" amarelo', '.market-home .section-heading a', 'backgroundColor', AMARELO_CLARO);
const campaign = await page.locator('.campaign-card').first().evaluate(el => getComputedStyle(el).backgroundImage).catch(() => '');
ok('campanha em bloco marinho', campaign.includes('16, 31, 112'), campaign.slice(0, 60));
await assertCss(page, 'navegação ativa marinho', '.bottom-nav a.active .nav-icon', 'backgroundColor', MARINHA);
await assertCss(page, 'preço marinho', '.market-price strong', 'color', MARINHA);

await page.screenshot({ path: `${SHOTS}/3-home.png` });
// Visitante vê acesso visível ao login direto na loja
const pill = page.locator('.login-pill');
ok('home mostra botão Entrar para visitante', await pill.isVisible() && (await pill.getAttribute('href')) === '/login');
await pill.click();
await page.waitForSelector('.auth-page, .form-stack', { timeout: 8000 });
ok('botão Entrar leva à tela de login', page.url().includes('/login'));
await page.goBack();
await page.waitForSelector('.market-home', { timeout: 8000 });
await page.evaluate(() => window.scrollTo(0, 700));
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/4-home-trilhos.png` });

// 6) Popup de ofertas ao entrar na loja (delay do ADM = 3s)
const promo = page.locator('.promotion-overlay');
await promo.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
ok('popup de ofertas aparece ao entrar na compra', await promo.isVisible());
const promoTitle = await page.locator('#promotion-title').textContent().catch(() => '');
ok('popup com identidade Berêrê e ofertas', /OFERTAS/i.test(promoTitle) && (await page.locator('.promotion-item').count()) > 0, promoTitle);
await page.screenshot({ path: `${SHOTS}/8-popup-ofertas.png` });
await page.locator('.promotion-close').click();
await promo.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});

// 7) Cupom recorrente: força o próximo disparo (a cada 5 min)
await page.evaluate(() => localStorage.setItem('bereree-coupon-next', String(Date.now() - 1)));
const coupon = page.locator('.coupon-dialog');
await coupon.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
ok('popup de cupom dispara a cada 5 minutos', await coupon.isVisible());
const code = await page.locator('.coupon-code').textContent().catch(() => '');
ok('cupom com código Berêrê', code.trim() === 'BERE5', code);
await page.screenshot({ path: `${SHOTS}/9-popup-cupom.png` });
await page.locator('.promotion-close').click();

await browser.close();
console.log(fails.length ? `\nFALHAS: ${fails.join(' ; ')}` : '\nTUDO OK');
process.exit(fails.length ? 1 : 0);
