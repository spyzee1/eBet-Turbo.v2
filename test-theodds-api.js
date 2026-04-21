// The Odds API Teszt Script
// Cél: bet-at-home odds lekérése esoccer meccsekhez

const API_KEY = '51643bd68e7ce7d7c22a6cbafaaf914e';
const BASE_URL = 'https://api.the-odds-api.com/v4';

// Tesztelendő sportok
const SPORTS_TO_TEST = [
  'soccer_epl',           // Premier League
  'soccer_spain_la_liga', // La Liga
  'soccer_italy_serie_a', // Serie A
  'soccer_germany_bundesliga', // Bundesliga
  'esports_lol',          // eSports - League of Legends
  'esports_dota2',        // eSports - Dota 2
  'esports_csgo',         // eSports - CS:GO
];

async function listAvailableSports() {
  const url = `${BASE_URL}/sports?apiKey=${API_KEY}`;
  
  console.log(`\n========================================`);
  console.log(`📋 ELÉRHETŐ SPORTOK LEKÉRÉSE`);
  console.log(`========================================\n`);

  try {
    const response = await fetch(url);
    
    if (response.ok) {
      const sports = await response.json();
      
      console.log(`✅ Összesen ${sports.length} sport elérhető\n`);
      
      // Szűrjük az esoccer/esports sportokat
      const esportsSports = sports.filter(s => 
        s.key.toLowerCase().includes('esport') || 
        s.key.toLowerCase().includes('esoccer') ||
        s.title.toLowerCase().includes('esport') ||
        s.title.toLowerCase().includes('esoccer') ||
        s.title.toLowerCase().includes('virtual')
      );
      
      if (esportsSports.length > 0) {
        console.log(`🎮 ESPORTS/ESOCCER SPORTOK TALÁLVA:\n`);
        esportsSports.forEach(sport => {
          console.log(`  🏆 ${sport.title}`);
          console.log(`     Key: ${sport.key}`);
          console.log(`     Група: ${sport.group}\n`);
        });
        return esportsSports.map(s => s.key);
      } else {
        console.log(`⚠️ Nincs esports/esoccer kategória\n`);
        console.log(`📝 Elérhető sportok (első 10):`);
        sports.slice(0, 10).forEach(sport => {
          console.log(`  - ${sport.title} (${sport.key})`);
        });
        return [];
      }
    } else {
      console.log(`❌ Hiba: ${response.status}`);
      return [];
    }
  } catch (error) {
    console.log(`💥 HIBA:`, error.message);
    return [];
  }
}

async function getOddsForSport(sportKey) {
  const url = `${BASE_URL}/sports/${sportKey}/odds?apiKey=${API_KEY}&regions=eu&markets=totals,h2h&bookmakers=betathome`;
  
  console.log(`\n========================================`);
  console.log(`🎲 ODDS LEKÉRÉS: ${sportKey}`);
  console.log(`📡 Bookmaker: bet-at-home`);
  console.log(`📊 Markets: totals (O/U), h2h (1X2)`);
  console.log(`========================================\n`);

  try {
    const response = await fetch(url);
    
    console.log(`✅ Status: ${response.status} ${response.statusText}`);
    
    // Remaining quota ellenőrzés
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');
    if (remaining) {
      console.log(`📊 API Quota: ${used} használt / ${remaining} maradt\n`);
    }

    if (response.ok) {
      const data = await response.json();
      
      if (!data || data.length === 0) {
        console.log(`⚠️ Nincs elérhető meccs\n`);
        return null;
      }

      console.log(`✅ ${data.length} meccs találva\n`);
      
      // Első meccs részletes elemzése
      const match = data[0];
      console.log(`🏆 ELSŐ MECCS RÉSZLETEI:\n`);
      console.log(`   Csapatok: ${match.home_team} vs ${match.away_team}`);
      console.log(`   Kezdés: ${new Date(match.commence_time).toLocaleString('hu-HU')}\n`);
      
      // Bookmaker odds keresése
      const betAtHomeOdds = match.bookmakers?.find(b => b.key === 'betathome');
      
      if (betAtHomeOdds) {
        console.log(`   🎯 BET-AT-HOME ODDS TALÁLVA!\n`);
        
        // H2H (1X2) odds
        const h2hMarket = betAtHomeOdds.markets?.find(m => m.key === 'h2h');
        if (h2hMarket) {
          console.log(`   📈 H2H (1X2) Odds:`);
          h2hMarket.outcomes.forEach(outcome => {
            console.log(`      ${outcome.name}: ${outcome.price}`);
          });
          console.log();
        }
        
        // Totals (O/U) odds
        const totalsMarket = betAtHomeOdds.markets?.find(m => m.key === 'totals');
        if (totalsMarket) {
          console.log(`   📊 TOTALS (O/U) Odds:`);
          totalsMarket.outcomes.forEach(outcome => {
            console.log(`      ${outcome.name} ${outcome.point}: ${outcome.price}`);
          });
          console.log();
          
          // O/U vonal kiemelése
          const overOutcome = totalsMarket.outcomes.find(o => o.name === 'Over');
          if (overOutcome) {
            console.log(`   🎯 O/U VONAL: ${overOutcome.point}`);
            console.log(`   ✅ Ez az érték kell a Vegas.hu-hoz!\n`);
          }
        } else {
          console.log(`   ⚠️ Nincs Totals (O/U) adat\n`);
        }
        
        return {
          match: `${match.home_team} vs ${match.away_team}`,
          ouLine: totalsMarket?.outcomes.find(o => o.name === 'Over')?.point,
          oddsOver: totalsMarket?.outcomes.find(o => o.name === 'Over')?.price,
          oddsUnder: totalsMarket?.outcomes.find(o => o.name === 'Under')?.price,
          oddsHome: h2hMarket?.outcomes.find(o => o.name === match.home_team)?.price,
          oddsAway: h2hMarket?.outcomes.find(o => o.name === match.away_team)?.price,
        };
      } else {
        console.log(`   ❌ Nincs bet-at-home odds erre a meccsre\n`);
        console.log(`   📋 Elérhető bookmaker-ek:`);
        match.bookmakers?.forEach(b => {
          console.log(`      - ${b.title} (${b.key})`);
        });
        console.log();
        return null;
      }
    } else {
      const errorText = await response.text();
      console.log(`❌ Hiba válasz:`, errorText.substring(0, 200));
      return null;
    }

  } catch (error) {
    console.log(`💥 HIBA:`, error.message);
    return null;
  }
}

async function runTests() {
  console.log(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║      The Odds API Teszt - bet-at-home odds         ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `);

  // 1. Sportok listázása
  const esportKeys = await listAvailableSports();
  
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 2. Ha találtunk esport kategóriát, használjuk azt
  const sportsToTest = esportKeys.length > 0 ? esportKeys : SPORTS_TO_TEST;
  
  console.log(`\n🧪 ${sportsToTest.length} sport tesztelése...\n`);
  
  const results = [];
  
  for (const sport of sportsToTest.slice(0, 3)) { // Csak első 3 hogy ne fogyjon el a quota
    const result = await getOddsForSport(sport);
    if (result) {
      results.push({ sport, ...result });
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n
╔════════════════════════════════════════════════════╗
║                   TESZT KÉSZ                       ║
╚════════════════════════════════════════════════════╝
  `);

  if (results.length > 0) {
    console.log(`\n✅ SIKERES TALÁLATOK:\n`);
    results.forEach(r => {
      console.log(`🏆 ${r.sport}: ${r.match}`);
      console.log(`   O/U vonal: ${r.ouLine || 'N/A'}`);
      console.log(`   Over odds: ${r.oddsOver || 'N/A'}`);
      console.log(`   Under odds: ${r.oddsUnder || 'N/A'}\n`);
    });
  } else {
    console.log(`\n⚠️ NINCS TALÁLAT\n`);
    console.log(`Lehetséges okok:`);
    console.log(`1. Nincs esoccer kategória a The Odds API-ban`);
    console.log(`2. bet-at-home nem támogatott bookmaker`);
    console.log(`3. Nincs jelenleg elérhető meccs\n`);
  }

  console.log(`
📝 KÖVETKEZŐ LÉPÉSEK:

✅ HA MŰKÖDIK:
   - Integráljuk a backendbe
   - Lecseréljük a TotalCorner O/U vonalakat
   - Pontos Vegas.hu kompatibilis odds-ok

❌ HA NEM MŰKÖDIK:
   - AllSportsAPI próba (más bookmaker-ek)
   - Vagy maradunk TotalCorner-nél + manuális korrekció
  `);
}

// Futtatás
runTests().catch(console.error);
