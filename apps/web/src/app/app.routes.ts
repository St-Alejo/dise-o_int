import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

/** Todas las páginas se cargan de forma diferida: Three.js solo se descarga al abrir un proyecto. */
export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage), title: 'Interiores IA' },
  {
    path: 'entrar',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/auth.page').then((m) => m.AuthPage),
    data: { mode: 'login' },
    title: 'Entrar — Interiores IA',
  },
  {
    path: 'registro',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/auth.page').then((m) => m.AuthPage),
    data: { mode: 'register' },
    title: 'Crear cuenta — Interiores IA',
  },
  {
    path: 'proyectos',
    canActivate: [authGuard],
    loadComponent: () => import('./features/projects/projects.page').then((m) => m.ProjectsPage),
    title: 'Mis proyectos — Interiores IA',
  },
  {
    path: 'proyectos/nuevo',
    canActivate: [authGuard],
    loadComponent: () => import('./features/upload/new-project.page').then((m) => m.NewProjectPage),
    title: 'Nuevo proyecto — Interiores IA',
  },
  {
    path: 'proyectos/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/project/project.page').then((m) => m.ProjectPage),
    title: 'Proyecto — Interiores IA',
  },
  {
    path: 'p/:token',
    loadComponent: () => import('./features/public/public-project.page').then((m) => m.PublicProjectPage),
    title: 'Proyecto compartido — Interiores IA',
  },
  {
    path: '**',
    loadComponent: () => import('./features/home/not-found.page').then((m) => m.NotFoundPage),
    title: 'No encontrado — Interiores IA',
  },
];
