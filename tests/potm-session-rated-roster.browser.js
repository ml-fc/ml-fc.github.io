// Run using a local server on 4173:
// playwright-cli run-code --filename=tests/potm-session-rated-roster.browser.js
// All backend requests use disposable fixtures.
async (page) => {
  const context = await page.context().browser().newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  page = await context.newPage();
  try {
    const assert = (value,message) => {if (!value) throw new Error(message);};
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const user = {name:'Admin',isAdmin:1,photoUrl:'http://127.0.0.1:4173/assets/icons/icon-192.png',phone:'',email:'',emailVerifiedAt:''};
    const season = {seasonId:'session-fixture',name:'Fixture season',status:'OPEN',startDate:'2026-01-01',endDate:'2099-12-31'};
    const match = {matchId:'rated-fixture',publicCode:'RATED-FIXTURE',seasonId:season.seasonId,title:'Rated fixture',type:'INTERNAL',date:'2026-01-01',time:'19:00',status:'OPEN',ratingsLocked:0,availabilityLocked:1,availabilityLimit:22,scoreHome:'2',scoreAway:'1',ratingCount:2,potmOpenedAt:'2026-01-01T09:00:00Z',teamSelectionMode:'MANUAL'};
    let teams = [{playerName:'Admin',team:'BLUE',positionX:50,positionY:94},{playerName:'Fixture Player',team:'ORANGE',positionX:50,positionY:94}];
    let availability = ['Admin','Fixture Player','Late Player'].map(playerName=>({playerName,availability:'YES',timestamp:'2026-01-01',playerDeclared:'YES'}));
    const calls = [];
    let meMode = 'offline';
    let releaseMe;
    await page.route('https://mlfc-api.manorlakes-football.workers.dev/**', async route => {
      const req = route.request();
      const params = req.method()==='POST' ? new URLSearchParams(req.postData()) : new URL(req.url()).searchParams;
      const action = params.get('action');
      calls.push({action,payload:Object.fromEntries(params)});
      let data = {ok:true};
      let status = 200;
      if (action==='me') {
        if (meMode==='offline') return route.abort('internetdisconnected');
        if (meMode==='pending') await new Promise(resolve=>{releaseMe=resolve;});
        if (meMode==='invalid') {data={ok:false,error:'Not logged in'};status=401;}
        else if (meMode==='server') {data={ok:false,error:'Temporary failure'};status=503;}
        else if (meMode==='legacy-server') {data={ok:false,error:'D1 unavailable'};status=401;}
        else data={ok:true,user};
      }
      if (action==='seasons') data={ok:true,seasons:[season],currentSeasonId:season.seasonId};
      if (action==='public_match') data={ok:true,match:{...match},teams,availability,captains:{captain1:'Admin',captain1Team:'BLUE',captain2:'Fixture Player',captain2Team:'ORANGE'},ratings:[],events:[],potm:{openedAt:match.potmOpenedAt,closed:false,canVote:true,myVote:'',candidates:teams,voteCount:0}};
      if (action==='admin_list_matches') data={ok:true,matches:[match]};
      if (action==='admin_potm_status') data={ok:true,voted:[],pending:teams};
      if (action==='players') data={ok:true,players:['Admin','Fixture Player','Late Player']};
      if (action==='notifications') data={ok:true,notifications:[],unreadCount:0};
      if (action==='admin_match_grounds') data={ok:true,grounds:[]};
      if (action==='admin_update_availability_limit') match.availabilityLimit=Number(params.get('availabilityLimit'));
      if (action==='admin_setup_internal') teams=[...JSON.parse(params.get('bluePlayers')).map(playerName=>({playerName,team:'BLUE'})),...JSON.parse(params.get('orangePlayers')).map(playerName=>({playerName,team:'ORANGE'}))];
      if (action==='admin_setup_opponent') teams=JSON.parse(params.get('mlfcPlayers')).map(playerName=>({playerName,team:'MLFC'}));
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('http://127.0.0.1:4173/manifest.json');
    await page.evaluate(user=>{
      localStorage.clear();sessionStorage.clear();
      localStorage.setItem('mlfc_token_v1','fixture-token');
      localStorage.setItem('mlfc_user_v1',JSON.stringify(user));
      localStorage.setItem('mlfc_push_enable_reminder_v1','1');
    },user);
    // Opening a POTM link performs a fresh identity check. A network failure
    // used to destroy the stored session here.
    await page.goto('http://127.0.0.1:4173/#/match?code=RATED-FIXTURE&focus=potm');
    await page.locator('#potmFieldDialog[open]').waitFor();
    assert(await page.evaluate(()=>localStorage.getItem('mlfc_token_v1'))==='fixture-token','POTM link preserves login during a network failure');
    await page.locator('#potmFieldDialog .potmFieldDialog__close').click();
    for (const mode of ['server','legacy-server']) {
      meMode=mode;
      const result=await page.evaluate(async()=>{const auth=await import('/src/auth.js');return {user:await auth.refreshMe(true),token:auth.getToken()};});
      assert(result.token==='fixture-token' && result.user.name==='Admin',`${mode} does not log out the player`);
    }
    meMode='valid';
    // Both team editor variants must call full setup, not captain-only save.
    for (const type of ['INTERNAL','OPPONENT']) {
      match.type=type;
      teams=type==='INTERNAL' ? [{playerName:'Admin',team:'BLUE',positionX:50,positionY:94},{playerName:'Fixture Player',team:'ORANGE',positionX:50,positionY:94}] : [{playerName:'Admin',team:'MLFC',positionX:50,positionY:94},{playerName:'Fixture Player',team:'MLFC',positionX:50,positionY:8}];
      await page.evaluate(()=>{for(const key of Object.keys(localStorage)) if(key.includes('cache') || key.includes('draft'))localStorage.removeItem(key);});
      await page.goto(`http://127.0.0.1:4173/?type=${type}#/admin?view=manage&code=RATED-FIXTURE&prev=open`);
      const manage=page.locator('#manageArea');
      await manage.locator('#availLimitInput').waitFor({state:'attached'});
      await manage.locator('details').filter({has:page.locator('#availLimitInput')}).locator('summary').click();
      assert(!await manage.locator('#availLimitSave').isDisabled(),'Cap is editable after ratings, with availability closed');
      await manage.locator('#availLimitInput').fill('26');
      await manage.locator('#availLimitSave').click();
      await page.waitForFunction(()=>document.querySelector('#availLimitInput')?.value==='26');
      const field=manage.locator(type==='INTERNAL'?'#digitalTeamPreview':'#opponentTeamPreview');
      await field.locator('button[data-open]').first().click();
      await field.locator('dialog[open]').waitFor();
      assert(!await field.locator('.fieldRoster__tag[data-name="Late Player"]').isDisabled(),'Late player can be assigned during ratings');
      await field.locator('.fieldRoster__tag[data-name="Late Player"]').click();
      await field.locator(`[data-assign="${type==='INTERNAL'?'BLUE':'MLFC'}"]`).click();
      await field.locator('.sharedPitch [data-name="Late Player"]').click();
      await field.locator('[data-position]').selectOption('CM');
      await field.locator('[data-save]').click();
      const action=type==='INTERNAL'?'admin_setup_internal':'admin_setup_opponent';
      await page.waitForFunction(()=>document.querySelector('#draftState')?.textContent==='All setup changes saved');
      const save=calls.filter(c=>c.action===action).at(-1);
      assert(save && JSON.parse(save.payload.positions).some(p=>p.playerName==='Late Player' && p.positionX===50 && p.positionY===48),`${type}: full roster and position saved after ratings`);
      assert(!calls.some(c=>c.action==='admin_update_captains'),'Saving the roster never falls back to captain-only updates');
      assert(calls.some(c=>c.action==='admin_update_availability_limit' && c.payload.availabilityLimit==='26'),'Updated cap sent to API');
      await field.locator('button[data-open]').first().click();
      await field.locator('.sharedPitch [data-name="Late Player"]').click();
      await field.locator('[data-position]').selectOption('LW');
      await field.locator('[data-back]').click();
      // Lowering a cap can waitlist someone who already played. Draft restore
      // must keep that saved participant and their ratings in the team.
      availability=availability.map(row=>row.playerName==='Fixture Player'?{...row,availability:'WAITING'}:row);
      await page.reload();
      await field.locator('button[data-open]').first().click();
      assert(await field.locator('.sharedPitch [data-name="Fixture Player"]').count()===1,`${type}: draft retains a rated player moved to the waitlist`);
      await field.locator('.sharedPitch [data-name="Late Player"]').click();
      await field.locator('[data-remove]').click();
      let beforeSaves=calls.filter(c=>c.action===action).length;
      page.once('dialog',dialog=>dialog.dismiss());
      await field.locator('[data-save]').click();
      assert(calls.filter(c=>c.action===action).length===beforeSaves,'Canceling removal keeps the existing roster');
      await field.locator('button[data-open]').first().click();
      page.once('dialog',dialog=>dialog.accept());
      await field.locator('[data-save]').click();
      await page.waitForFunction(()=>document.querySelector('#draftState')?.textContent==='All setup changes saved');
      assert(calls.filter(c=>c.action===action).length===beforeSaves+1,'Confirmed removal saves the revised roster');
      availability=availability.map(row=>({...row,availability:'YES'}));

    }
    // Reject genuine expiry, but ignore an old request after another login.
    meMode='pending';
    await page.evaluate(()=>{window.fixtureRefresh=import('/src/auth.js').then(auth=>auth.refreshMe(true));});
    while(!releaseMe) await new Promise(resolve=>setTimeout(resolve,20));
    await page.evaluate(()=>localStorage.setItem('mlfc_token_v1','replacement-token'));
    meMode='invalid';releaseMe();
    await page.evaluate(()=>window.fixtureRefresh);
    assert(await page.evaluate(()=>localStorage.getItem('mlfc_token_v1'))==='replacement-token','Stale rejection does not clear a newer session');
    await page.evaluate(async()=>{await (await import('/src/auth.js')).refreshMe(true);});
    assert(!await page.evaluate(()=>localStorage.getItem('mlfc_token_v1')),'Genuinely expired session still clears authentication');
    assert(!errors.length,`No application errors: ${errors.join(', ')}`);
    return {passed:['POTM link with network failure','server failure','genuine session expiry','stale session response','rated internal roster and positions','rated opponent roster and positions','availability cap after ratings'],applicationErrors:errors};
  } finally {await context.close();}
}
