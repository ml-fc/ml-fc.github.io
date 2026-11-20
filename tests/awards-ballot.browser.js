// playwright-cli run-code --filename=tests/awards-ballot.browser.js
// Synthetic ballots only. All API requests are intercepted; no production writes.
async (page) => {
  const context=await page.context().browser().newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  page=await context.newPage();
  try {
    const assert=(ok,message)=>{if(!ok)throw new Error(message);};
    const errors=[],calls=[];
    page.on('pageerror',e=>errors.push(e.message));
    const season={seasonId:'fixture-compact',name:'Summer season',status:'OPEN',startDate:'2026-01-01',endDate:'2099-12-31'};
    const players=['Alex Morgan','Jamie Clarke','Sam Taylor','Jordan Williams','Casey Bennett','Charlie Evans','Robin Campbell','Drew Mitchell','Morgan Parker','Riley Anderson','Cameron Hughes','Taylor Wilson','Alexandra Montgomery-Williams','Jesse Turner','Avery Collins','Bailey Stewart','Harper Davis','Quinn Robinson','Reese Walker','Skyler Thompson'];
    const names=['Players’ player','Goal of the season','Most improved player','Club spirit','Best teammate','Save of the season'];
    const awards=names.map((name,i)=>({awardId:`award-${i}`,seasonId:season.seasonId,name,kind:'CUSTOM',status:'OPEN',deadline:i===1?'2099-12-21T08:00:00.000Z':'2099-12-20T08:00:00.000Z',revision:1,nominees:players.map((playerName,j)=>({playerName,...(j%3===0?{overall:80,position:'MID'}:{})})),totalVotes:3,totalEligible:20,myVote:i===2?players[1]:'',canVote:true}));
    let failVote=false,failAwards=false;
    let voteGate=null,releaseVote;
    await page.route('https://mlfc-api.manorlakes-football.workers.dev/**',async route=>{
      const req=route.request();
      const params=req.method()==='POST'?new URLSearchParams(req.postData()):new URL(req.url()).searchParams;
      const action=params.get('action');calls.push({action,payload:Object.fromEntries(params)});
      let data={ok:true};
      if(action==='me')data={ok:true,user:{name:players[0],isAdmin:1,photoUrl:'/assets/icons/icon-192.png',phone:'0400000000',email:'fixture@example.test',emailVerifiedAt:'2026-01-01'}};
      if(action==='seasons')data={ok:true,seasons:[season],currentSeasonId:season.seasonId};
      if(action==='season_honours')data={ok:true,current:{seasonId:season.seasonId,name:season.name,deadline:'2026-12-31T13:00:00.000Z'},seasons:[],hasMore:false};
      if(action==='public_open_matches'||action==='public_past_matches')data={ok:true,matches:[],total:0,hasMore:false};
      if(action==='public_matches_meta')data={ok:true,fingerprint:'fixture',latestCode:''};
      if(action==='my_next_match')data={ok:true,match:null};
      if(action==='notifications')data={ok:true,notifications:[],unreadCount:0};
      if(action==='leaderboard_season')data={ok:true,rows:[{playerName:players[0],goals:12,assists:4,matchesPlayed:15,matchesRated:12,avgRating:8.5,potmAwards:3}]};
      if(action==='season_awards')data=failAwards?{ok:false,error:'Fixture awards unavailable'}:{ok:true,season,awards,players};
      if(action==='award_vote'){
        if(voteGate)await voteGate;
        if(failVote)data={ok:false,error:'Fixture vote unavailable'};
        else Object.assign(awards.find(a=>a.awardId===params.get('awardId')),{myVote:params.get('candidateName')});
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('http://127.0.0.1:4173/manifest.json');
    await page.evaluate(name=>{
      localStorage.clear();sessionStorage.clear();
      localStorage.setItem('mlfc_token_v1','fixture-only');
      localStorage.setItem('mlfc_user_v1',JSON.stringify({name,isAdmin:1,photoUrl:'/assets/icons/icon-192.png',phone:'0400000000',email:'fixture@example.test',emailVerifiedAt:'2026-01-01'}));
    },players[0]);
    await page.goto(`http://127.0.0.1:4173/#/awards?seasonId=${season.seasonId}`);
    const ballots=page.locator('.awardBallots');
    await ballots.locator('[data-id="award-0"]').waitFor();
    const compact=await ballots.locator('details.awardBallot').count()>0;
    const version=compact?'after':'before';
    await page.screenshot({path:`output/playwright/awards-ballot-${version}-390.png`,animations:'disabled'});
    await ballots.scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/awards-categories-${version}-390.png`,animations:'disabled'});
    const metrics=await ballots.evaluate(el=>({ballotHeight:Math.round(el.getBoundingClientRect().height),nomineeGridHeight:Math.round(el.querySelector('.awardNominees').getBoundingClientRect().height)}));
    assert(compact,'Ballot uses collapsible categories');
    const first=ballots.locator('[data-id="award-0"]'),second=ballots.locator('[data-id="award-1"]');
    const progress=page.locator('.awardBallotProgress');
    assert(await ballots.locator('[open]').count()===1,'One pending category starts open');
    assert((await progress.innerText()).includes('1 voted · 5 pending'),'Counts reflect saved votes');
    assert(await first.getByRole('radio',{name:`${players[0]} (you)`,exact:true}).isDisabled(),'Self vote disabled');
    await first.getByRole('radio',{name:players[1],exact:true}).locator('..').click();
    assert(await first.locator('.awardCategory__mark--voted').count()===0,'Choosing a nominee does not mark a vote saved');
    await second.locator('summary').focus();await page.keyboard.press('Enter');
    await first.locator('form').waitFor({state:'hidden'});
    assert(await second.evaluate(el=>el.open),'Keyboard opens a category and collapses the previous one');
    await first.locator('summary').click();
    assert(await first.getByRole('radio',{name:players[1],exact:true}).isChecked(),'Collapsing preserves an unsaved choice');
    voteGate=new Promise(resolve=>{releaseVote=resolve;});
    await first.getByRole('button',{name:'Confirm vote'}).click();
    await first.locator('form').evaluate(form=>form.requestSubmit());
    assert(await first.getByRole('button',{name:'Working…'}).isDisabled(),'Save is disabled while request is pending');
    assert(calls.filter(c=>c.action==='award_vote').length===1,'Duplicate submit is blocked');
    releaseVote();voteGate=null;
    await first.locator('.awardCategory__mark--voted').waitFor();
    assert(!await first.evaluate(el=>el.open),'Saved category collapses');
    assert((await progress.innerText()).includes('2 voted · 4 pending'),'Saving updates progress');
    assert(await first.locator('summary').evaluate(el=>document.activeElement===el),'Focus returns to completed category');
    assert(calls.filter(c=>c.action==='award_vote').length===1,'One mutation per save');
    await page.getByRole('button',{name:'Dismiss notification'}).evaluateAll(buttons=>buttons.forEach(button=>button.click()));
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'output/playwright/awards-overview-after-390.png',animations:'disabled'});
    await first.locator('summary').click();
    await first.getByRole('radio',{name:players[2],exact:true}).locator('..').click();
    await first.getByRole('button',{name:'Update vote'}).click();
    await first.locator('summary').filter({hasText:`Your vote: ${players[2]}`}).waitFor();
    assert((await progress.innerText()).includes('2 voted · 4 pending'),'Updating a vote does not double-count');
    await second.locator('summary').click();
    await second.getByRole('radio',{name:players[1],exact:true}).locator('..').click();
    failVote=true;
    await second.getByRole('button',{name:'Confirm vote'}).click();
    await page.getByText('Fixture vote unavailable',{exact:true}).waitFor();
    assert(await second.getByRole('radio',{name:players[1],exact:true}).isChecked(),'Failure preserves selection');
    assert(!await second.getByRole('button',{name:'Confirm vote'}).isDisabled(),'Failure allows retry');
    assert(await second.locator('.awardCategory__mark--voted').count()===0,'Failure does not show completion tick');
    failVote=false;
    await page.getByRole('button',{name:'Dismiss notification'}).evaluateAll(buttons=>buttons.forEach(button=>button.click()));
    await page.getByRole('button',{name:'Refresh awards and leaders'}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-refresh][aria-busy]'));
    assert(await second.evaluate(el=>el.open),'Refresh preserves expanded category');
    assert(await second.getByRole('radio',{name:players[1],exact:true}).isChecked(),'Refresh preserves unsaved choice');
    assert(await page.locator('[data-refresh]').evaluate(el=>el===document.activeElement),'Refresh retains keyboard focus');
    // Closed, draft and ineligible categories must not inflate pending counts.
    awards.push({...awards[0],awardId:'closed',name:'Final category',status:'CLOSED',canVote:false,winners:[players[2]],results:[{playerName:players[2],votes:4}]},
      {...awards[0],awardId:'draft',name:'Draft category',status:'DRAFT',canVote:false,myVote:''},
      {...awards[0],awardId:'ineligible',name:'Restricted category',canVote:false,myVote:''});
    await page.getByRole('button',{name:'Refresh awards and leaders'}).click();
    await ballots.locator('[data-id="ineligible"]').waitFor();
    assert((await progress.innerText()).includes('2 voted · 4 pending'),'Only eligible open categories count as pending');
    const restricted=ballots.locator('[data-id="ineligible"]');
    await restricted.locator('summary').click();
    assert(await restricted.locator('input:not(:disabled)').count()===0,'Ineligible player cannot vote');
    assert(await restricted.getByRole('button').count()===0,'Ineligible category has no vote button');
    const closed=ballots.locator('[data-id="closed"]');
    await closed.locator(':scope > summary').click();
    assert(await closed.locator('.awardWinner').isVisible(),'Closed category retains winner');
    assert(await closed.locator('form').count()===0,'Closed category has no form');
    await closed.getByText('View results',{exact:true}).click();
    assert((await closed.locator('.awardResults').innerText()).includes('4 votes'),'Results remain accessible');
    // Screenshots with the same initial fixture and with a collapsed overview.
    await closed.locator('summary').first().click();
    const collapsedHeight=await ballots.evaluate(el=>Math.round(el.getBoundingClientRect().height));
    await ballots.scrollIntoViewIfNeeded();
    await page.screenshot({path:'output/playwright/awards-completed-390.png',animations:'disabled'});
    await first.locator('summary').click();
    const layouts=[];
    for(const width of [320,360,390,430,768,1280]){
      await page.setViewportSize({width,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${width}`);
      const geometry=await first.locator('.awardNominees').evaluate(el=>({columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,overflow:[...el.querySelectorAll('strong')].some(n=>n.scrollWidth>n.clientWidth),smallestTarget:Math.min(...[...el.children].map(n=>n.getBoundingClientRect().height))}));
      assert(geometry.columns===2,`Two player columns at ${width}`);
      assert(!geometry.overflow,`Long names fit at ${width}`);
      assert(geometry.smallestTarget>=44,`Touch targets at least 44px at ${width}`);
      layouts.push({width,...geometry});
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(async()=>{
      const {GOAT_THEMES,applyWeeklyTheme}=await import('/src/themes.js');
      applyWeeklyTheme({enabled:true,theme:GOAT_THEMES.find(t=>!t.collective)});
    });
    await first.locator('summary').scrollIntoViewIfNeeded();
    await page.screenshot({path:'output/playwright/awards-theme-390.png',animations:'disabled'});
    await page.locator('.awardLeadersPanel>summary').click();
    assert(await page.locator('.awardLeaders__grid').isVisible(),'Season leaders available on demand');
    assert((await page.locator('.awardLeaders__grid').innerText()).includes('12 goals'),'Statistics unchanged');
    // Home uses saved choices and refreshes when returning from the ballot.
    await page.evaluate(async()=>{
      const {applyWeeklyTheme}=await import('/src/themes.js');applyWeeklyTheme({enabled:false});
      location.hash='#/match';window.scrollTo(0,0);
    });
    const home=page.locator('[data-route="#/match"]');
    await home.locator('[data-awards-summary]').filter({hasText:'2 voted · 4 pending'}).waitFor();
    assert((await home.locator('.seasonCountdown__awards').getAttribute('href')).includes(season.seasonId),'Home summary links to the current ballot');
    for(const width of [320,360,390,430,768,1280]){
      await page.setViewportSize({width,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Home progress fits at ${width}`);
      assert((await home.locator('.seasonCountdown__awards').boundingBox()).height>=44,`Home Awards target at least 44px at ${width}`);
    }
    await page.setViewportSize({width:390,height:844});
    await home.locator('.seasonCountdown').scrollIntoViewIfNeeded();
    await page.screenshot({path:'output/playwright/awards-home-progress-390.png',animations:'disabled'});
    await home.locator('.seasonCountdown__awards').click();
    await second.waitFor();
    if(!await second.evaluate(el=>el.open))await second.locator('summary').click();
    await second.getByRole('radio',{name:players[1],exact:true}).locator('..').click();
    await second.getByRole('button',{name:'Confirm vote'}).click();
    await second.locator('.awardCategory__mark--voted').waitFor();
    await page.locator('[data-awards-back]').click();
    await home.locator('[data-awards-summary]').filter({hasText:'3 voted · 3 pending'}).waitFor();
    for(const a of awards)if(a.status==='OPEN' && a.canVote)a.myVote=players[1];
    await home.locator('.seasonCountdown__awards').click();
    await page.locator('[data-awards-back]').click();
    await home.locator('[data-awards-summary]').filter({hasText:'6 voted · 0 pending'}).waitFor();
    failAwards=true;
    await home.locator('.seasonCountdown__awards').click();
    await page.getByText('Could not load the ballot',{exact:true}).waitFor();
    await page.evaluate(()=>{location.hash='#/match';});
    await home.locator('[data-awards-summary]').filter({hasText:'View voting'}).waitFor();
    assert(!(await home.locator('[data-awards-summary]').innerText()).includes('0 pending'),'Failed request does not invent completion counts');
    failAwards=false;
    for(const a of awards){a.status='CLOSED';a.canVote=false;}
    await home.locator('.seasonCountdown__awards').click();
    await page.locator('[data-awards-back]').click();
    await home.locator('[data-awards-summary]').filter({hasText:'View awards'}).waitFor();
    assert(errors.length===0,`No runtime errors: ${errors.join('; ')}`);
    return {result:'passed',metrics,collapsedHeight,layouts,checks:'save/update/failure, keyboard categories, self/ineligible/closed gates, saved progress, refresh preserves choice, leaders, home progress, themes'};
  } finally {await context.close();}
}
