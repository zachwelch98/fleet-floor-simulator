import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  it('renders the shell', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Fleet Floor Simulator');
  });
});
