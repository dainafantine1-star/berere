import React from 'react';
import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {render,screen,waitFor,fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {useShop,cartSubtotal,quantityStep,restoreCart} from './store';
import Account from './account';
import {FeedbackProvider} from './ui';
const product={id:'banana-prata',api_id:1,nome:'Banana prata',preco:10,estoque:5,unit:'kg'};
const privateState={user:null,guestId:'guest',csrfToken:'csrf-test',orders:[],addresses:[],favorites:[],shoppingLists:[],settings:{}};
const catalog={products:[{id:1,slug:'banana-prata',name:'Banana prata',price:10,stock:5,available:true,unit:'kg',category:'frutas'}],categories:[{id:'frutas',label:'Frutas'}],banners:[],settings:{maxQuoteQuantity:99},app:{videos:[],paymentMethods:['dinheiro']}};
const response=(data,ok=true)=>({ok,json:async()=>data});
beforeEach(()=>{localStorage.clear();useShop.setState({products:[product],cart:{},checkout:{mode:'retirada',payment:'dinheiro',notes:'',customerName:'Maria',customerPhone:'75999998888'},requestKey:null,user:null,orders:[],addresses:[],favorites:[],shoppingLists:[],ready:false});});
afterEach(()=>vi.unstubAllGlobals());
describe('Estado integrado ao servidor',()=>{
 it('descarta quantidades inválidas do carrinho salvo',()=>{expect(restoreCart({'banana-prata':.25,negativo:-1,texto:'2',infinito:Infinity,excesso:100,precisao:.0001})).toEqual({'banana-prata':.25});expect(restoreCart([])).toEqual({});});
 it('ignora identidade e pedidos injetados no armazenamento local',async()=>{localStorage.setItem('bereree-app-v4',JSON.stringify({version:1,state:{cart:{'banana-prata':1},user:{id:'intruso'},orders:[{id:'privado'}],ready:true}}));await useShop.persist.rehydrate();expect(useShop.getState().user).toBeNull();expect(useShop.getState().orders).toEqual([]);expect(useShop.getState().ready).toBe(false);});
 it('inicializa catálogo e sessão pela API sem usar o catálogo persistido antigo',async()=>{
  vi.stubGlobal('fetch',vi.fn(async url=>response(url.endsWith('/catalog')?catalog:url.endsWith('/session')?privateState:privateState)));
  await useShop.getState().initialize();expect(useShop.getState().ready).toBe(true);expect(useShop.getState().products).toHaveLength(1);expect(useShop.getState().products[0].api_id).toBe(1);expect(useShop.getState().categories[0].nome).toBe('Frutas');
 });
 it('calcula peso em milésimos e subtotal por item em centavos',()=>{useShop.getState().add('banana-prata',.25);expect(quantityStep(product)).toBe(.25);expect(cartSubtotal(useShop.getState().cart,[product])).toBe(2.5);useShop.getState().add('banana-prata',10);expect(useShop.getState().cart['banana-prata']).toBe(5);});
 it('mantém a cesta em falha de rede e reutiliza a chave ao reenviar',async()=>{
  const fetch=vi.fn().mockRejectedValue(Error('Sem conexão'));vi.stubGlobal('fetch',fetch);useShop.getState().add('banana-prata',.5);
  await expect(useShop.getState().placeOrder()).rejects.toThrow('Sem conexão');const key=useShop.getState().requestKey;
  await expect(useShop.getState().placeOrder()).rejects.toThrow();expect(JSON.parse(fetch.mock.calls[1][1].body).requestKey).toBe(key);expect(useShop.getState().cart['banana-prata']).toBe(.5);
 });
 it('somente limpa a cesta após confirmação do servidor',async()=>{
  vi.stubGlobal('fetch',vi.fn(async url=>response(url.endsWith('/shop/orders')?{id:'order-1',total:5}:url.endsWith('/catalog')?catalog:privateState)));
  useShop.getState().add('banana-prata',.5);const order=await useShop.getState().placeOrder();expect(order.id).toBe('order-1');expect(useShop.getState().cart).toEqual({});expect(useShop.getState().requestKey).toBeNull();
 });
 it('retorna o pedido confirmado sem esperar a atualização de fundo',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  vi.stubGlobal('fetch',vi.fn(url=>url.endsWith('/shop/orders')?Promise.resolve(response({id:'confirmado',total:5})):pending.then(()=>response(url.endsWith('/catalog')?catalog:privateState))));
  useShop.getState().add('banana-prata',.5);const order=await useShop.getState().placeOrder();expect(order.id).toBe('confirmado');
  release();await waitFor(()=>expect(useShop.getState().orders).toEqual([]));
 });
 it('não persiste conta, endereço, senha ou pedidos no localStorage',()=>{
  useShop.setState({user:{id:'private-user',email:'privado@example.test'},addresses:[{rua:'Rua privada'}],orders:[{id:'pedido-privado'}],checkout:{customerPhone:'75999998888'}});
  const persisted=localStorage.getItem('bereree-app-v4');expect(persisted).not.toContain('privado');expect(persisted).not.toContain('private-user');expect(persisted).not.toContain('75999998888');
 });
 it('mostra erro de login do servidor e permite nova tentativa',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>response({error:'E-mail ou senha inválidos.'},false)));
  render(<MemoryRouter><FeedbackProvider><Account screen="login"/></FeedbackProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'maria@example.test'}});fireEvent.change(screen.getByLabelText('Senha'),{target:{value:'senha-incorreta'}});fireEvent.submit(screen.getByLabelText('E-mail').closest('form'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','E-mail ou senha inválidos.');await waitFor(()=>expect(screen.getByRole('button',{name:'Entrar'}).disabled).toBe(false));expect(useShop.getState().user).toBeNull();
 });
});
