import {
  test,
  expect,
  setTenantBilling,
  cleanupBillingData,
  seedSubscriptionForWebhook,
  postSignedWebhook,
  getTenantBillingState,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

/**
 * Ciclo de suscripcion de punta a punta, sin pagar de verdad.
 *
 * El hueco que cubre esto: hasta ahora se probaba el endpoint del webhook de
 * forma aislada y la pagina de billing por separado, pero nadie comprobaba que
 * un `authorized` de MercadoPago termine dejando al usuario con el plan
 * activo. Ese es el fallo que duele: el usuario pago y no puede usar el
 * producto, y si el flujo no esta probado nadie lo nota hasta que lo reporta.
 *
 * El chequeo se hace sobre la BASE, no sobre la UI: la UI puede estar cacheada
 * y dar un verde falso. `getTenantBillingState` lee las filas con service role.
 */
test.describe('Ciclo de suscripcion E2E', () => {
  test.beforeAll(async () => {
    // Base: branchs dados de baja, sin preapproval. Es el estado previo al pago.
    await setTenantBilling('starter', 'free', true);
  });

  test.afterAll(async () => {
    await cleanupBillingData();
  });

  test('webhook authorized activa el plan en la base', async ({ authenticatedPage: page }) => {
    const seeded = await seedSubscriptionForWebhook('business');
    test.skip(!seeded, 'Supabase E2E no configurado');
    const { preapprovalId, externalReference } = seeded!;

    const before = await getTenantBillingState();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((t) => t.subscription_status === 'canceled')).toBe(true);

    const res = await postSignedWebhook(page, {
      id: preapprovalId,
      topic: 'subscription_preapproval',
      mpStatus: 'authorized',
      externalReference,
    });

    expect(res.status).toBe(200);

    const after = await getTenantBillingState();
    // El plan tiene que verse activo en TODAS las sucursales del owner: la
    // suscripcion se consolida a nivel owner, no de branch.
    expect(after.every((t) => t.subscription_status === 'active')).toBe(true);
    expect(after.every((t) => t.subscription_plan === 'business')).toBe(true);
  });

  test('el mismo webhook reenviado no rompe nada', async ({ authenticatedPage: page }) => {
    // Idempotencia sobre el flujo real: MercadoPago reintenta, y dos entregas
    // del mismo evento no pueden degradar el estado.
    const seeded = await seedSubscriptionForWebhook('business');
    test.skip(!seeded, 'Supabase E2E no configurado');
    const { preapprovalId, externalReference } = seeded!;

    await postSignedWebhook(page, {
      id: preapprovalId,
      topic: 'subscription_preapproval',
      mpStatus: 'authorized',
      externalReference,
    });

    const second = await postSignedWebhook(page, {
      id: preapprovalId,
      topic: 'subscription_preapproval',
      mpStatus: 'authorized',
      externalReference,
    });

    expect(second.status).toBe(200);

    const after = await getTenantBillingState();
    expect(after.every((t) => t.subscription_status === 'active')).toBe(true);
    expect(after.every((t) => t.subscription_plan === 'business')).toBe(true);
  });

  test('webhook cancelled da de baja el plan', async ({ authenticatedPage: page }) => {
    const seeded = await seedSubscriptionForWebhook('business');
    test.skip(!seeded, 'Supabase E2E no configurado');
    const { preapprovalId, externalReference } = seeded!;

    await postSignedWebhook(page, {
      id: preapprovalId,
      topic: 'subscription_preapproval',
      mpStatus: 'authorized',
      externalReference,
    });

    const cancel = await postSignedWebhook(page, {
      id: preapprovalId,
      topic: 'subscription_preapproval',
      mpStatus: 'cancelled',
      externalReference,
    });

    expect(cancel.status).toBe(200);

    const after = await getTenantBillingState();
    expect(after.every((t) => t.subscription_status === 'canceled')).toBe(true);
    // El plan vuelve a free: es lo que habilita volver a pagar.
    expect(after.every((t) => t.subscription_plan === 'free')).toBe(true);
    // Y se limpia el preapproval para que una cancelacion vieja no affecte a una
    // suscripcion nueva.
    expect(after.every((t) => t.mercadopago_preapproval_id === null)).toBe(true);
  });

  test('un webhook sin firma no toca la base', async ({ authenticatedPage: page }) => {
    const seeded = await seedSubscriptionForWebhook('business');
    test.skip(!seeded, 'Supabase E2E no configurado');
    const { preapprovalId, externalReference } = seeded!;

    const before = await getTenantBillingState();

    const response = await page.request.post('/api/webhooks/mercadopago', {
      headers: { 'content-type': 'application/json' },
      data: {
        type: 'subscription_preapproval',
        data: { id: preapprovalId, status: 'authorized', external_reference: externalReference },
      },
    });

    expect(response.status()).toBe(401);

    const after = await getTenantBillingState();
    // Sin firma no se acepta el evento: si cambiara algo, cualquiera podria
    // activar planes sin pagar.
    expect(after).toEqual(before);
  });

  test('un payload invalido se rechaza antes de tocar la base', async ({
    authenticatedPage: page,
  }) => {
    const before = await getTenantBillingState();

    const res = await postSignedWebhook(page, {
      id: '   ',
      topic: 'subscription_preapproval',
    });

    expect(res.status).toBe(400);
    expect(await getTenantBillingState()).toEqual(before);
  });

  test('un preapproval ajeno no activa el plan de nuestra sucursal', async ({
    authenticatedPage: page,
  }) => {
    // `external_reference` es la unica guia de a que sucursal pertenece el
    // evento. Si no apunta a ninguna, el evento se rechaza en vez de
    // activar algo al azar.
    const res = await postSignedWebhook(page, {
      id: `e2e-pa-${Date.now()}`,
      topic: 'subscription_preapproval',
      mpStatus: 'authorized',
      externalReference: '',
    });

    expect(res.status).toBe(400);
    expect((res.json as { error?: string }).error).toBe('No external reference');
  });
});

