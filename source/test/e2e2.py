import asyncio, subprocess, sys, json, datetime
from playwright.async_api import async_playwright
PORT = 8771
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', 'dist/site'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
today = datetime.date.today(); y = today - datetime.timedelta(days=1)
# Stage 1 shaped records: key type:date, no createdAt
OLD = [{'key': 'water:%s' % y, 'type': 'water', 'date': str(y), 'value': 3, 'updatedAt': 1},
       {'key': 'walk:%s' % y, 'type': 'walk', 'date': str(y), 'value': True, 'updatedAt': 1},
       {'key': 'read:%s' % y, 'type': 'read', 'date': str(y), 'value': {'book': 'Atomic Habits', 'pct': 12}, 'updatedAt': 1}]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        orig_click = pg.click
        async def dismiss():
            if await pg.locator('.levelup').count():
                print('  level-up shown:', (await pg.text_content('.levelup .box')).strip()); await orig_click('.levelup button')
        async def click(sel, **kw):
            await dismiss(); await orig_click(sel, **kw)
        pg.click = click
        url = 'http://localhost:%d/' % PORT
        await pg.goto(url); await pg.wait_for_selector('.habit')
        await pg.evaluate("""(recs) => new Promise(r => { const q = indexedDB.open('dynasty'); q.onsuccess = () => { const t = q.result.transaction('records','readwrite'); recs.forEach(x => t.objectStore('records').put(x)); t.oncomplete = () => r(); }; })""", OLD)
        await pg.reload(); await pg.wait_for_selector('.habit')
        print('career XP with stage-1 data:', await pg.text_content('.dayxp .meta'))
        # checklist toggles
        for h in ['workout', 'macros', 'cardio']:
            await pg.click('.habit[data-habit=%s] [data-act=toggle]' % h); await pg.wait_for_timeout(250)
        await pg.click('.habit[data-habit=sleep] [data-act=sleep]'); await pg.fill('#sleep-in', '7.5'); await pg.click('#f button[type=submit]'); await pg.wait_for_timeout(300)
        print('XP today:', await pg.text_content('.dayxp .big em'))
        await pg.screenshot(path='shots/s2-gameday.png', full_page=True)
        # Log tab entries
        await pg.click('.tab[data-tab=log]'); await pg.wait_for_timeout(150)
        await pg.click('.tile[data-act=bonds]'); await pg.fill('#bond-note', 'Mom'); await pg.click('[data-kind=call]'); await pg.wait_for_timeout(300)
        await pg.click('.tile[data-act=bonds]'); await pg.click('[data-kind=call]'); await pg.wait_for_timeout(300)
        print('second call toast:', await pg.text_content('#toasts'))
        await pg.click('.tile[data-act=echo]'); await pg.click('[data-ch="1"]'); await pg.wait_for_timeout(300)
        await pg.click('.tile[data-act=echo]'); await pg.click('[data-ch="2"]'); await pg.wait_for_timeout(300)
        await pg.click('.tile[data-act=career]'); await pg.click('#f button[type=submit]')
        print('career validation:', await pg.text_content('#err'))
        await pg.fill('#car-title', 'Applied to Director role'); await pg.click('[data-tier="0"]'); await pg.check('#car-dir'); await pg.click('#f button[type=submit]'); await pg.wait_for_timeout(300)
        await pg.click('.tile[data-act=wealth]'); await pg.fill('#bal-in', '80250'); await pg.click('#f button[type=submit]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/s2-log.png', full_page=True)
        await pg.click('.tab[data-tab=quests]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path='shots/s2-quests.png', full_page=True)
        await pg.reload(); await pg.wait_for_selector('.habit')
        data = await pg.evaluate("""() => new Promise(r => { const q = indexedDB.open('dynasty'); q.onsuccess = () => { const g = q.result.transaction('records').objectStore('records').getAll(); g.onsuccess = () => r(g.result); }; })""")
        types = sorted(x['type'] for x in data)
        print('stored after reload:', len(data), types)
        print('stage-1 records intact:', all(any(d['key'] == o['key'] and d['value'] == o['value'] for d in data) for o in OLD))
        print('bug:', (await pg.text_content('.bug')).strip())
        print('errors:', [e for e in errs])
        await b.close()
asyncio.run(main()); srv.terminate()
