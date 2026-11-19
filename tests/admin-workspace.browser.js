// Run with a local server on port 4173 and an open Playwright CLI browser:
// playwright-cli run-code --filename=tests/admin-workspace.browser.js
// Synthetic fixtures only. Every backend request is fulfilled locally.
async (page) => {
  const fixtureContext = await page.context().browser().newContext({ serviceWorkers: 'block' });
  page = await fixtureContext.newPage();
  try {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const calls = [];
  const seasons = [
    { seasonId:'fixture-current', name:'2026–27 Summer', startDate:'2026-09-01', endDate:'2099-03-31', status:'OPEN' },
    { seasonId:'fixture-old', name:'Winter championship with a very long season name for mobile layouts', startDate:'2025-04-01', endDate:'2025-09-30', status:'CLOSED' }
  ];
  const matches = [
    {matchId:'active', publicCode:'FIXTURE-ACTIVE', title:'Friday night football', date:'2026-01-15', time:'19:00', type:'INTERNAL', status:'OPEN', ratingsLocked:'FALSE', scoreHome:2, scoreAway:1},
    {matchId:'upcoming', publicCode:'FIXTURE-UPCOMING', title:'Manor Lakes summer friendly', date:'2099-01-20', time:'19:00', type:'OPPONENT', status:'OPEN', ratingsLocked:'FALSE'},
    ...Array.from({length:15}, (_,i) => ({matchId:`past-${i}`, publicCode:`FIXTURE-PAST-${i}`, title:i===0 ? 'Summer cup final with a long match title that wraps comfortably on phones' : `Summer round ${i+1}`, date:`2025-08-${String(28-i).padStart(2,'0')}`, time:'19:00', type:'INTERNAL', status:i===1?'CLOSED':'COMPLETED', ratingsLocked:i===1?'FALSE':'TRUE', scoreHome:3, scoreAway:2, potmOpenedAt:'2025-08-01', potmVoteCount:4}))
  ];
  let failCreate = true;
  let failList = false;
  let failGround = false;
  let holdCreate;
  let createGate = null;
  await page.route('https://mlfc-api.manorlakes-football.workers.dev/**', async route => {
    const request = route.request();
    const params = request.method()==='POST' ? new URLSearchParams(request.postData()) : new URL(request.url()).searchParams;
    const action = params.get('action');
    calls.push({action, method:request.method(), payload:Object.fromEntries(params)});
    let data = {ok:true};
    if (action==='seasons') data = {ok:true, seasons, currentSeasonId:seasons[0]?.seasonId || ''};
    if (action==='me') data = {ok:true,user:{name:'Admin',isAdmin:1,photoUrl:'http://127.0.0.1:4173/assets/icons/icon-192.png',phone:'',email:'',emailVerifiedAt:''}};
    if (action==='admin_list_matches') data = failList ? {ok:false,error:'Fixture connection unavailable.'} : {ok:true,matches:params.get('seasonId')===seasons[0]?.seasonId?matches:[]};
    if (action==='public_match') data = {ok:true,match:matches.find(m=>m.publicCode===params.get('code')),teams:[],availability:[],captains:{},potm:{}};
    if (action==='admin_users' || action==='players') data = {ok:true,users:[{name:'Fixture player',phone:'',isAdmin:0,playerStatus:'ACTIVE'}],players:[]};
    if (action==='admin_theme_settings') data = {ok:true,enabled:false,theme:null,apiConfigured:true};
    if (action==='admin_create_match') {
      if (createGate) await createGate;
      data = failCreate ? {ok:false,error:'Fixture validation error — keep editing.'} : {ok:true,matchId:'created',publicCode:'FIXTURE-CREATED',seasonId:params.get('seasonId')};
    }
    if (action==='admin_update_match_ground') {
      if (failGround) data = {ok:false,error:'Fixture ground save failed.'};
      else {
        const ground = {groundName:params.get('groundName'),groundUrl:params.get('groundUrl')};
        Object.assign(matches.find(m=>m.matchId===params.get('matchId')), ground);
        data = {ok:true,...ground};
      }
    }
    if (action==='admin_potm_status') data = {ok:true,voted:[],pending:[]};
    if (action==='notifications') data = {ok:true,notifications:[],unreadCount:0};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:4173/manifest.json');
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('mlfc_token_v1','local-fixture-only');
    localStorage.setItem('mlfc_user_v1',JSON.stringify({name:'Admin',isAdmin:1,photoUrl:'http://127.0.0.1:4173/assets/icons/icon-192.png',phone:'',email:'',emailVerifiedAt:''}));
  });
  await page.goto('http://127.0.0.1:4173/?fixture=club-desk#/admin');
  const desk = page.locator('[data-route="#/admin"]');
  await desk.locator('.adminMatchRow').first().waitFor();
  assert(await desk.locator('.adminPrimaryNav a[aria-current]').innerText()==='Matches','Plain admin defaults to Matches');
  assert(!await desk.locator('#seasonMgmt').isVisible(),'Settings hidden above list');
  assert(!calls.some(c=>c.action==='admin_users'||c.action==='admin_theme_settings'),'Occasional tools load lazily');
  const listCalls = () => calls.filter(c=>c.action==='admin_list_matches').length;
  const initialCalls = listCalls();
  for (const width of [360,390,768,1280]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${width}px`);
    await desk.locator('.adminPrimaryNav a').nth(1).waitFor({state:'visible'});
    await page.screenshot({path:`output/playwright/matches-${width}.png`,animations:'disabled'});
  }
  await page.setViewportSize({width:390,height:844});
  await desk.locator('#openCreateMatch').click();
  assert(await desk.locator('#createMatchCard').isVisible(),'One tap opens creation');
  assert(await desk.locator('#availabilityLimit').inputValue()==='22','Internal player limit retained');
  await page.keyboard.press('Shift+Tab');
  assert(await desk.locator('#createMatchCard').evaluate(el=>el.contains(document.activeElement)),'Modal traps backward keyboard focus');
  await page.keyboard.press('Tab');
  assert(await desk.locator('#title').evaluate(el=>el===document.activeElement),'Modal wraps keyboard focus');
  await desk.locator('#type').selectOption('OPPONENT');
  assert(await desk.locator('#availabilityLimit').inputValue()==='11','Opponent limit retained');
  assert(await desk.locator('#teamHomeName').isDisabled(),'Opponent team-name rule retained');
  await desk.locator('#type').selectOption('INTERNAL');
  await desk.locator('#title').fill('My saved match draft');
  await desk.locator('#teamHomeName').fill('Custom home');
  await desk.locator('#groundName').fill('Lakes Reserve & Oval');
  await desk.locator('#groundUrl').fill('https://maps.google.com/?q=Lakes&zoom=14');
  await desk.locator('#availabilityLimit').fill('24');
  await page.keyboard.press('Escape');
  assert(await desk.locator('#openCreateMatch').evaluate(el=>el===document.activeElement),'Escape restores focus');
  await desk.locator('.adminPrimaryNav a').nth(1).click();
  await desk.locator('#clubOverview').waitFor({state:'visible'});
  for (const width of [360,390,768,1280]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Club management has no overflow at ${width}px`);
    await page.screenshot({path:`output/playwright/club-management-${width}.png`,animations:"disabled"});
  }
  await desk.locator('.adminTools a[href*="announcements"]').click();
  await desk.locator('#announcementTitle').fill('Draft announcement');
  await desk.locator('#announcementMessage').fill('Do not send this fixture.');
  await desk.locator('.adminPrimaryNav a').first().click();
  await desk.locator('#openCreateMatch').click();
  assert(await desk.locator('#title').inputValue()==='My saved match draft','Draft survives tabs');
  assert(await desk.locator('#availabilityLimit').inputValue()==='24','Custom limit survives tabs');
  await page.keyboard.press('Escape');
  assert(listCalls()===initialCalls,`Routine tab changes reuse match cache (${initialCalls} → ${listCalls()})`);
  await desk.locator('#seasonSelect').selectOption('fixture-old');
  await desk.locator('#openCreateMatch').click();
  assert((await desk.locator('#createSeasonContext').innerText()).includes(seasons[0].name),'Draft stays bound to its original season');
  assert(!await desk.locator('#createMatch').isDisabled(),'Draft uses original open season');
  await page.keyboard.press('Escape');
  await desk.locator('#seasonSelect').selectOption('fixture-current');
  await desk.locator('#openCreateMatch').click();
  await desk.locator('#createMatch').click();
  assert((await desk.locator('#created').innerText()).includes('choose a match date'),'Date validation retained');
  await desk.locator('#date').fill('2099-01-18');
  await desk.locator('#createMatch').click();
  await desk.locator('#created').filter({hasText:'Fixture validation error'}).waitFor();
  assert(await desk.locator('#title').inputValue()==='My saved match draft','Failure retains values');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/create-match-phone.png',animations:'disabled'});
  await page.keyboard.press('Escape');
  await page.reload();
  await desk.locator('#openCreateMatch').click();
  assert(await desk.locator('#teamHomeName').inputValue()==='Custom home','Reload restores custom team name');
  assert(await desk.locator('#availabilityLimit').inputValue()==='24','Reload restores custom limit');
  assert(await desk.locator('#groundName').inputValue()==='Lakes Reserve & Oval','Reload retains ground name');
  assert(await desk.locator('#groundUrl').inputValue()==='https://maps.google.com/?q=Lakes&zoom=14','Reload retains ground URL');
  const beforeInvalidGround = calls.filter(c=>c.action==='admin_create_match').length;
  await desk.locator('#groundUrl').fill('javascript:alert(1)');
  await desk.locator('#createMatch').click();
  assert((await desk.locator('#created').innerText()).includes('valid HTTP'),'Ground URL is validated inline');
  assert(calls.filter(c=>c.action==='admin_create_match').length===beforeInvalidGround,'Invalid location never submitted');
  await desk.locator('#groundUrl').fill('https://maps.google.com/?q=Lakes&zoom=14');
  failCreate=false;
  createGate=new Promise(resolve=>{holdCreate=resolve;});
  const beforeCreate=calls.filter(c=>c.action==='admin_create_match').length;
  await desk.locator('#createMatch').click();
  await desk.locator('#createMatch').evaluate(el=>{el.dispatchEvent(new MouseEvent('click',{bubbles:true}));el.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  assert(await desk.locator('#closeCreateMatch').isDisabled(),'Controls disabled while saving');
  holdCreate();
  await desk.locator('#createMatchCard').waitFor({state:'hidden'});
  assert(calls.filter(c=>c.action==='admin_create_match').length===beforeCreate+1,'Duplicate submissions prevented');
  assert(await desk.getByText('My saved match draft',{exact:true}).isVisible(),'Success updates list');
  assert(calls.filter(c=>c.action==='admin_create_match').at(-1).payload.groundName==='Lakes Reserve & Oval','Creation submits ground');
  await desk.locator('#seasonSelect').selectOption('fixture-old');
  await desk.locator('#openCreateMatch').click();
  assert(await desk.locator('#createMatch').isDisabled(),'Closed seasons prevent match creation');
  page.once('dialog',dialog=>dialog.accept());
  await desk.locator('#discardCreateMatch').click();
  await desk.locator('#seasonSelect').selectOption('fixture-current');
  await desk.locator('#goPast').click();
  await desk.locator('#goPast[aria-current]').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('[data-route="#/admin"] .adminMatchRow').length===12);
  assert(await desk.locator('.adminMatchRow').count()===12,'History initially paginated');
  await page.setViewportSize({width:360,height:800});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long past-match titles wrap on a 360px phone');
  assert((await desk.locator('.adminMatchRow__title').first().innerText()).includes('Summer cup final'),'Past newest first');
  assert(await desk.locator('[data-manage="FIXTURE-PAST-0"]').isDisabled(),'Locked match cannot be managed');
  const closed=desk.locator('.adminMatchRow').filter({has:page.locator('[data-manage="FIXTURE-PAST-1"]')});
  assert(await closed.locator('[data-score]').isDisabled(),'Closed matches cannot be scored');
  await desk.locator('#showMoreMatches').click();
  assert(await desk.locator('.adminMatchRow').count()===15,'Show more uses local history');
  await desk.locator('.adminMoreActions summary').first().focus();
  await page.keyboard.press('Enter');
  assert(await desk.locator('[data-unlock]').first().isVisible(),'Keyboard opens secondary actions');
  await page.keyboard.press('Escape');
  await desk.locator('#goOpen').click();
  const active = desk.locator('.adminMatchRow').filter({has:page.locator('[data-manage="FIXTURE-ACTIVE"]')});
  await active.locator('[data-stream]').waitFor({state:'visible'});
  assert(await active.locator('summary').count()===0,'Open matches show actions directly');
  assert(await active.locator('[data-stream]').isVisible(),'Streaming visible without an extra click');
  await active.locator('[data-lock]').click();
  await page.locator('#adminVotingDialog').waitFor();
  assert(!calls.some(c=>c.action==='admin_lock_ratings'),'POTM required before completion');
  await page.keyboard.press('Escape');
  await desk.locator('[data-manage="FIXTURE-ACTIVE"]').click();
  await desk.locator('#backToAdminList').waitFor();
  assert(!await desk.locator('#saveGround').isDisabled(),'Ground remains editable after scoring while match is open');
  await desk.locator('#editGroundUrl').fill('https://maps.google.com/?q=Away');
  await desk.locator('#saveGround').click();
  assert((await desk.locator('#editGroundMessage').innerText()).includes('ground name'),'Location requires a ground name');
  await desk.locator('#editGroundName').fill('Away Oval & Reserve');
  failGround=true;
  await desk.locator('#saveGround').click();
  await desk.locator('#editGroundMessage').filter({hasText:'Fixture ground save failed'}).waitFor();
  assert(await desk.locator('#editGroundName').inputValue()==='Away Oval & Reserve','Failed ground save retains entered values');
  failGround=false;
  await desk.locator('#saveGround').click();
  await desk.locator('.manageCommand .matchGround a').waitFor();
  assert(await desk.locator('.manageCommand .matchGround a').getAttribute('href')==='https://maps.google.com/?q=Away','Saved ground name is hyperlinked');
  await page.evaluate(()=>{window.open=url=>{window.fixtureShareUrl=url;return null;};});
  await page.evaluate(()=>window.scrollTo(0,0));
  await desk.locator('#shareMatch').click();
  const sharedText = await page.evaluate(()=>new URL(window.fixtureShareUrl).searchParams.get('text'));
  assert(sharedText.includes('Away Oval & Reserve') && sharedText.includes('https://maps.google.com/?q=Away') && sharedText.includes('#/match?code=FIXTURE-ACTIVE'),'WhatsApp text has ground, directions URL and stable match link');
  await page.locator('#toastHost .toast__close').evaluateAll(buttons=>buttons.forEach(button=>button.click()));
  for (const width of [360,1280]) {
    await page.setViewportSize({width,height:900});
    await desk.locator('#editGroundName').scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Ground editor fits viewport');
    await page.screenshot({path:`output/playwright/match-ground-edit-${width}.png`,animations:'disabled'});
  }
  // Existing sign-in flow preserves the shared match URL.
  await page.evaluate(()=>{localStorage.removeItem('mlfc_token_v1');localStorage.removeItem('mlfc_user_v1');});
  await page.goto('http://127.0.0.1:4173/#/match?code=FIXTURE-ACTIVE');
  await page.waitForURL(/#\/login\?return=/);
  assert(decodeURIComponent(page.url()).includes('#/match?code=FIXTURE-ACTIVE'),'Shared match preserved through sign-in');
  await page.evaluate(()=>{localStorage.setItem('mlfc_token_v1','local-fixture-only');localStorage.setItem('mlfc_user_v1',JSON.stringify({name:'Admin',isAdmin:1,photoUrl:'http://127.0.0.1:4173/assets/icons/icon-192.png',phone:'',email:'',emailVerifiedAt:''}));});
  await page.goto('http://127.0.0.1:4173/#/match?code=FIXTURE-ACTIVE');
  const publicGround = page.locator('#matchDetailView .matchGround a');
  await publicGround.waitFor();
  assert(await publicGround.innerText()==='Away Oval & Reserve','Shared match displays the ground name');
  assert(await publicGround.getAttribute('href')==='https://maps.google.com/?q=Away','Match recipients can open directions');
  assert(await publicGround.getAttribute('rel')==='noopener noreferrer','External ground link is isolated');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/shared-match-ground-phone.png',animations:'disabled'});
  const rendering = await page.evaluate(async()=>{
    const {matchGroundHtml,matchGroundText,groundValidation}=await import('/src/ui/match_ground.js');
    const host=document.createElement('div');
    host.innerHTML=matchGroundHtml({groundName:'<img src=x onerror=alert(1)>',groundUrl:'javascript:alert(1)'});
    return {safe:!host.querySelector('img,a'),noGround:matchGroundHtml({})==='',plain:matchGroundText({groundName:'Reserve'}),bad:groundValidation('Reserve','data:text/html,test')};
  });
  assert(rendering.safe && rendering.noGround && rendering.plain==='📍 Reserve' && rendering.bad,'Ground rendering handles optional fields and untrusted API values');
  await page.evaluate(()=>{localStorage.setItem('mlfc_token_v1','local-fixture-only');localStorage.setItem('mlfc_user_v1',JSON.stringify({name:'Admin',isAdmin:1}));});
  await page.goto('http://127.0.0.1:4173/#/admin?view=manage&code=FIXTURE-ACTIVE&prev=open');
  await desk.locator('#editGroundName').waitFor();
  await desk.locator('#editGroundName').fill('');
  await desk.locator('#editGroundUrl').fill('');
  await desk.locator('#saveGround').click();
  await page.waitForFunction(()=>!document.querySelector('#manageArea .manageCommand .matchGround'));
  assert(matches[0].groundName==='' && matches[0].groundUrl==='','Ground and location can be cleared');
  await desk.locator('#backToAdminList').click();
  await desk.locator('#goOpen[aria-current]').waitFor();
  assert(await desk.locator('#seasonSelect').inputValue()==='fixture-current','Manage return retains season');
  await desk.locator('[data-score="FIXTURE-ACTIVE"]').click();
  await page.locator('#captainRatingWizard[open]').waitFor();
  await page.goBack();
  await desk.locator('#goOpen[aria-current]').waitFor();
  assert(await page.locator('dialog:modal').count()===0,'Browser Back closes the scoring modal');
  await desk.locator('[data-score="FIXTURE-ACTIVE"]').click();
  await page.locator('[data-route="#/captain"]').waitFor({state:'visible'});
  if (!await page.locator('#captainRatingWizard').isVisible()) await page.locator('#openRatingWizard').click();
  await page.locator('#closeRatingWizard').click();
  await page.locator('[data-route="#/captain"] #openMatch').click();
  await desk.locator('#goOpen[aria-current]').waitFor();
  assert(await desk.locator('#seasonSelect').inputValue()==='fixture-current','Scoring return retains season and filter');
  await desk.locator('#goPast').click();
  await page.goBack();
  await desk.locator('#goOpen[aria-current]').waitFor();
  await page.goForward();
  await desk.locator('#goPast[aria-current]').waitFor();
  await page.reload();
  await desk.locator('#goPast[aria-current]').waitFor();
  assert(await desk.locator('.adminMatchRow').count()===12,'Refresh honors explicit Past route');
  await page.goto('http://127.0.0.1:4173/#/admin?view=users');
  await desk.locator('#userSearch').waitFor();
  assert(await desk.locator('.adminPrimaryNav a[aria-current]').innerText()==='Club management','Legacy users route opens Players');
  assert(!await desk.locator('#seasonBlock').isVisible(),'Global players not season-scoped');
  await desk.locator('#userSearch').fill('Fixture');
  assert(await desk.locator('#userSearch').evaluate(el=>el===document.activeElement),'Search keeps typing focus');
  await desk.locator('.adminPrimaryNav a').nth(1).click();
  await desk.locator('.adminTools a[href*="seasons"]').click();
  assert(await desk.locator('#seasonSelect').count()===1,'Single shared season selector');
  assert(!await desk.locator('#seasonForm').isVisible(),'Season creation initially collapsed');
  await desk.locator('#openSeasonForm').click();
  await desk.locator('#seasonName').fill('Unfinished season');
  await desk.locator('.adminPrimaryNav a').first().click();
  await desk.locator('.adminPrimaryNav a').nth(1).click();
  await desk.locator('.adminTools a[href*="seasons"]').click();
  assert(await desk.locator('#seasonName').inputValue()==='Unfinished season','Season form survives navigation');
  await desk.locator('.adminPrimaryNav a').nth(1).click();
  await desk.locator('.adminTools a[href*="appearance"]').click();
  await desk.locator('#themeSettingsCurrent').filter({hasText:'Manor Lakes theme'}).waitFor();
  const themeCalls=calls.filter(c=>c.action==='admin_theme_settings').length;
  await desk.locator('.adminPrimaryNav a').nth(1).click();
  await desk.locator('.adminTools a[href*="appearance"]').click();
  assert(calls.filter(c=>c.action==='admin_theme_settings').length===themeCalls,'Theme settings reuse loaded data');
  await desk.locator('.adminPrimaryNav a').nth(1).click();
  await desk.locator('.adminTools a[href*="announcements"]').click();
  // Full reload intentionally clears other unsent forms; within-session navigation is tested above.
  await desk.locator('#announcementTitle').fill('Preserved announcement');
  await desk.locator('.adminPrimaryNav a').first().click();
  await desk.locator('.adminPrimaryNav a').nth(1).click();
  await desk.locator('.adminTools a[href*="announcements"]').click();
  assert(await desk.locator('#announcementTitle').inputValue()==='Preserved announcement','Announcement draft retained on tab switches');
  assert(!calls.some(c=>c.action==='admin_broadcast_notification'),'Navigation never sends announcements');
  await desk.locator('.adminPrimaryNav a').first().click();
  failList=true;
  await desk.locator('#refreshAdminMatches').click();
  await desk.locator('#msg').filter({hasText:'Fixture connection unavailable'}).waitFor();
  assert(await desk.locator('.adminMatchRow').count()>0,'API errors keep cached cards');
  failList=false;
  await desk.locator('#refreshAdminMatches').click();
  await desk.locator('#msg').filter({hasText:''}).waitFor();
  assert(errors.length===0,`No runtime errors: ${errors.join('; ')}`);
  // Test theme rendering locally; no apply-theme or enable-theme API is called.
  const themeCount = await page.evaluate(async () => {
    const { EPL_THEMES, GOAT_THEMES, applyWeeklyTheme } = await import('/src/themes.js');
    const themes = [...EPL_THEMES,...GOAT_THEMES];
    for (const theme of themes) {
      applyWeeklyTheme({enabled:true,theme});
      const card = document.querySelector('#listArea > .card');
      if (getComputedStyle(document.querySelector('.adminDesk')).zIndex!=='2') throw new Error('Workspace must be above theme portrait');
      if (getComputedStyle(card).backgroundColor.startsWith('rgba')) throw new Error('Operational surface must be opaque');
      if (document.documentElement.scrollWidth>innerWidth) throw new Error('Theme introduces horizontal overflow');
    }
    applyWeeklyTheme({enabled:false,theme:null});
    return themes.length;
  });
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  assert(await desk.locator('[data-delete-match]').last().evaluate(el=>el.getBoundingClientRect().bottom<document.querySelector('.bottomnav').getBoundingClientRect().top),'Last card clears bottom navigation when scrolled to the end');
  const title=matches[0].title;
  matches[0].title='<img src=x onerror="window.fixtureXss=1">';
  await desk.locator('#refreshAdminMatches').click();
  await desk.locator('.adminMatchRow__title').filter({hasText:'<img src=x'}).waitFor();
  assert(await page.evaluate(()=>!window.fixtureXss && document.querySelector('.adminMatchRow__title').children.length===0),'Untrusted match titles render as text');
  matches[0].title=title;
  // An empty season response must also clear a previously remembered selection.
  const originalSeasons=[...seasons];
  seasons.length=0;
  await page.evaluate(()=>localStorage.removeItem('mlfc_seasons_cache_v1'));
  await page.reload();
  await desk.locator('#matchesList a[href*="seasons"]').waitFor();
  assert(await desk.locator('#seasonSelect').inputValue()==='','Missing seasons clear stale shared selection');
  await desk.locator('#matchesList a[href*="seasons"]').click();
  await desk.locator('#openSeasonForm').click();
  assert(await desk.locator('#seasonName').isVisible(),'No-season empty state leads to creation');
  seasons.push(...originalSeasons);
  assert(errors.length===0,`No runtime errors: ${errors.join('; ')}`);
  return {result:'passed',themeVariants:themeCount,initialListRequests:initialCalls,finalListRequests:listCalls(),checks:'ground creation/edit/clear, WhatsApp share, public linked ground, safe URLs, navigation, legacy routes, filters, pagination, state restrictions, draft retention, shared seasons, defaults, validation, duplicate submission, errors, focus, lazy loads, empty states, responsive layouts, themes, bottom navigation'};
  } finally { await fixtureContext.close(); }
}
