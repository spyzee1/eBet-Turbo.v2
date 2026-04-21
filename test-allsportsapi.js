// AllSportsAPI Teszt Script
// Cél: Megtalálni a megfelelő sport ID-t az esoccer meccsekhez

const API_KEY = '24bec21375mshe2e6aec6ecd5f4ep18bc17jsnbcb82c197f40';
const BASE_URL = 'https://allsportsapi2.p.rapidapi.com/api';

// Tesztelendő sport ID-k és event ID-k
const TESTS = [
  { sport: 'soccer', eventId: '10974920', description: 'Soccer (normál foci)' },
  { sport: 'esoccer', eventId: '10974920', description: 'eSoccer' },
  { sport: 'american-football', eventId: '10974920', description: 'American Football (eredeti példa)' },
  { sport: 'football', eventId: '10974920', description: 'Football' },
];

async function testEndpoint(sport, eventId, description) {
  const url = `${BASE_URL}/${sport}/event/${eventId}/odds`;
  
  console.log(`\n========================================`);
  console.log(`🧪 TESZT: ${description}`);
  console.log(`📡 URL: ${url}`);
  console.log(`========================================\n`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': 'allsportsapi2.p.rapidapi.com',
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      
      // Ellenőrizzük van-e odds adat
      if (data && typeof data === 'object') {
        console.log(`📊 Válasz típusa: ${Array.isArray(data) ? 'Array' : 'Object'}`);
        console.log(`📋 Kulcsok:`, Object.keys(data).slice(0, 10));
        
        // Keressünk totals/over-under adatokat
        const jsonStr = JSON.stringify(data);
        const hasOdds = jsonStr.includes('odds') || jsonStr.includes('bookmaker');
        const hasTotals = jsonStr.includes('total') || jsonStr.includes('over') || jsonStr.includes('under');
        
        console.log(`🎲 Van odds adat: ${hasOdds ? '✅ IGEN' : '❌ NEM'}`);
        console.log(`📈 Van totals (O/U) adat: ${hasTotals ? '✅ IGEN' : '❌ NEM'}`);
        
        if (hasOdds || hasTotals) {
          console.log(`\n🎉 SIKERES TALÁLAT!`);
          console.log(`\n📄 Teljes válasz (első 500 karakter):`);
          console.log(JSON.stringify(data, null, 2).substring(0, 500) + '...');
        }
      } else {
        console.log(`⚠️ Üres vagy érvénytelen válasz`);
      }
    } else {
      const errorText = await response.text();
      console.log(`❌ Hiba válasz:`, errorText.substring(0, 200));
    }

  } catch (error) {
    console.log(`💥 HIBA:`, error.message);
  }
}

async function runAllTests() {
  console.log(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║        AllSportsAPI TESZT - Sport ID Kereső       ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `);

  for (const test of TESTS) {
    await testEndpoint(test.sport, test.eventId, test.description);
    // Kis szünet a rate limit miatt
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n
╔════════════════════════════════════════════════════╗
║                   TESZT KÉSZ                       ║
╚════════════════════════════════════════════════════╝
  `);

  console.log(`
📝 KÖVETKEZŐ LÉPÉSEK:

1. Nézd meg melyik sport ID adott vissza SIKERES választ
2. Ellenőrizd van-e "totals" vagy "over/under" adat
3. Ha találtunk működő endpointot, integráljuk a backendbe!

💡 TIP: Ha egyik sem működik, lehet hogy:
   - Más event ID kell (esoccer specifikus)
   - Más endpoint struktúra kell
   - Az API nem támogatja az esoccer-t
  `);
}

// Futtatás
runAllTests().catch(console.error);
