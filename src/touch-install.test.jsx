import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,act} from '@testing-library/react';
import {MemoryRouter,Routes,Route,useLocation,Link} from 'react-router-dom';
import {ZoomImage} from './ui';
import {InstallProvider,InstallPage} from './install';
function Location(){return <output data-testid="location">{useLocation().pathname}</output>}
function photo(){render(<MemoryRouter><Location/><ZoomImage src='/banana.png' alt='Banana' to='/produto/banana-prata'/></MemoryRouter>);return screen.getByRole('link',{name:'Comprar Banana'})}
function pointer(el,type,props={}){const e=new MouseEvent(type,{bubbles:true,button:0,clientX:20,clientY:20,...props});Object.defineProperty(e,'isPrimary',{value:true});fireEvent(el,e)}
afterEach(()=>vi.useRealTimers());
it('toque normal abre a compra sem ampliar a imagem',()=>{const el=photo();fireEvent.click(el);expect(screen.getByTestId('location').textContent).toBe('/produto/banana-prata');expect(screen.queryByRole('dialog')).toBeNull()});
it('segurar amplia e não navega ao soltar',()=>{vi.useFakeTimers();const el=photo();pointer(el,'pointerdown');act(()=>vi.advanceTimersByTime(550));expect(screen.getByRole('dialog')).toBeTruthy();pointer(el,'pointerup');fireEvent.click(el);expect(screen.getByTestId('location').textContent).toBe('/');});
it('arrastar para rolar cancela ampliação e navegação',()=>{vi.useFakeTimers();const el=photo();pointer(el,'pointerdown');pointer(el,'pointermove',{clientY:50});act(()=>vi.advanceTimersByTime(600));pointer(el,'pointerup');fireEvent.click(el);expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByTestId('location').textContent).toBe('/');});
it('o prompt capturado fora da tela de instalação permanece disponível ao navegar',async()=>{const prompt=vi.fn().mockResolvedValue(undefined);render(<MemoryRouter><InstallProvider><Routes><Route path='/' element={<Link to='/instalar'>Ir para instalação</Link>}/><Route path='/instalar' element={<InstallPage/>}/></Routes></InstallProvider></MemoryRouter>);const e=new Event('beforeinstallprompt',{cancelable:true});Object.assign(e,{prompt,userChoice:Promise.resolve({outcome:'dismissed'})});act(()=>window.dispatchEvent(e));expect(e.defaultPrevented).toBe(true);fireEvent.click(screen.getByRole('link',{name:'Ir para instalação'}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Instalar Berêrê'})));expect(prompt).toHaveBeenCalledOnce();expect(screen.getByText('No iPhone')).toBeTruthy();});
