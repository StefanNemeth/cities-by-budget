import fs from 'fs';
import request from 'request-promise-native';
import fx from 'money';

let MAP_CITY_NAMES_SKYSCANNER = {};
let CITIES = [];

function convertValue(val, from, to = 'EUR') {
    let converted = -1;
    try {
        converted = Math.ceil(fx.convert(val, {from, to}));
    } catch (e) {
        console.error(`Couldn't convert currency "${from}"`);
    }
    return converted;
}

function prepareCities(citiesWithExpenses) {
    const prepCities = citiesWithExpenses.map(c => {
        const city = c;

        if (!city.expenses) {
            return null;
        }

        for (const expense of c.expenses) {
            switch (expense.label) {
                case 'Average Daily Cost':
                    city.avgDaily = convertValue(expense.value, city.currency);
                    break;
                case 'Accommodation':
                    city.accommodation = convertValue(expense.value, city.currency);
                    break;
            }
        }
        return (city.avgDaily > -1 && city.accommodation > -1) ? Object.assign(city, {
            // Get rid of accommodation in daily costs
            avgDaily: city.avgDaily - city.accommodation,
        }) : null;
    }).filter(c => c !== null);

    return prepCities;
}

const BUDGET_TOLERANCE = 0.2;

async function fetchCheapestFlightPrice(from, to, dateFrom, dateTo) {
    const input = {
        flyFrom: from,
        to,
        dateFrom,
        dateTo: dateFrom,
        returnFrom: dateTo,
        returnTo: dateTo,
        partner: 'picky',
        sort: 'price',
        asc: 1,
        limit: 1,
        curr: 'EUR',
        typeFlight: 'round',
    };

    const formattedInput = Object.keys(input).map(key => `${key}=${input[key]}`).join('&');
    const requestUrl = 'https://api.skypicker.com/flights?' + formattedInput;

    let result = JSON.parse(await request.get(requestUrl)).data;

    if (result.length < 1) {
        return null;
    }

    return result[0];
}

function calculateDistance(city1, city2) {
    const _calcDistance = (lat1, lon1, lat2, lon2, unit = 'K') => {
        if ((lat1 == lat2) && (lon1 == lon2)) {
            return 0;
        } else {
            var radlat1 = Math.PI * lat1/180;
            var radlat2 = Math.PI * lat2/180;
            var theta = lon1-lon2;
            var radtheta = Math.PI * theta/180;
            var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
            if (dist > 1) {
                dist = 1;
            }
            dist = Math.acos(dist);
            dist = dist * 180/Math.PI;
            dist = dist * 60 * 1.1515;
            if (unit === 'K') { dist = dist * 1.609344 }
            if (unit === 'N') { dist = dist * 0.8684 }
            return dist;
        }
    };

    return _calcDistance(city1.lat, city1.lon, city2.lat, city2.lon);
}

// {
//     from
//     to,
//     flightPrice,
// }
let CITY_FLIGHTS_CACHE = [];

async function mapDaysToCity(city, from, budget) {
    const input = {
        dateFrom: '01/08/2020',
        dateTo: '08/08/2020',
    };

    const daysWithoutFlight = Math.floor(budget * (1 + BUDGET_TOLERANCE) / (city.avgDaily + city.accommodation));

    // No way
    if (daysWithoutFlight === 0) {
        return Object.assign(city, { days: 0 });
    }

    const cachedCity = CITY_FLIGHTS_CACHE.find(flight => {
        return (calculateDistance(city, flight.from) <= 400 && calculateDistance(from, flight.to) <= 400) || (calculateDistance(from, flight.from) <= 400 && calculateDistance(city, flight.to) <= 400);
    });

    // Re-use flight data from nearby city
    let cheapestFlight = cachedCity || null;

    if (cheapestFlight === null) {
        try {
            cheapestFlight = await fetchCheapestFlightPrice(MAP_CITY_NAMES_SKYSCANNER[from.asciiname] || from.asciiname, MAP_CITY_NAMES_SKYSCANNER[city.asciiname] || city.asciiname, input.dateFrom, input.dateTo);
            
            if (cheapestFlight !== null) {
                cheapestFlight.flightPrice = cheapestFlight.conversion['EUR'];

                CITY_FLIGHTS_CACHE.push({
                    from: { lat: from.lat, lon: from.lon, name: from.name },
                    to: { lat: city.lat, lon: city.lon, name: city.name },
                    flightPrice: cheapestFlight.flightPrice,
                });
            } else {
                CITY_FLIGHTS_CACHE.push({
                    from: { lat: from.lat, lon: from.lon, name: from.name },
                    to: { lat: city.lat, lon: city.lon, name: city.name },
                    flightPrice: -1,
                });
            }
        } catch (e) {
            // Remember error
            if (e.statusCode == 422) {
                CITY_FLIGHTS_CACHE.push({
                    from: { lat: from.lat, lon: from.lon, name: from.name },
                    to: { lat: city.lat, lon: city.lon, name: city.name },
                    flightPrice: -1,
                });
            } else {
                console.log(e.message);
            }
            return Object.assign(city, { days: 0 });
        }
    }

    if (cheapestFlight === null || cheapestFlight.flightPrice < 0) {
        return Object.assign(city, { days: 0 });
    }

    const daysWithFlight = Math.floor((budget * (1 + BUDGET_TOLERANCE) - cheapestFlight.flightPrice) / (city.avgDaily + city.accommodation));

    if (daysWithFlight <= 0) {
        return Object.assign(city, { days: 0 });
    }

    return Object.assign(city, {
        days: daysWithFlight,
        cheapestFlight,
        totalExpenses: (city.avgDaily + city.accommodation) * daysWithFlight + cheapestFlight.flightPrice,
    });
}

function loadInitialData() {
    fx.rates = JSON.parse(fs.readFileSync('data/currencyRates.json', 'utf8'));
    MAP_CITY_NAMES_SKYSCANNER = JSON.parse(fs.readFileSync('data/skyscannerMapping.json'));

    const rawData = fs.readFileSync('data/citiesWithExpenses.json', 'utf8');

    CITIES = prepareCities(JSON.parse(rawData));

    // Sort by population, airports at cities with higher population
    // tend to be cheaper to fly to => flight search results will be cached
    CITIES = CITIES.sort((a, b) => b.population - a.population);

    CITY_FLIGHTS_CACHE = JSON.parse(fs.readFileSync('cache/flightsCache.json'));
}

async function findCitiesByBudget(from, budget) {
    console.time('search-request');

    const cityFlightsCache = [];
    const citiesWithDays = (await Promise.all(CITIES.filter(c => c.id != from.id).map(c => mapDaysToCity(c, from, budget, cityFlightsCache)))).filter(city => city.days > 1);

    console.timeEnd('search-request');

    const sortedByPopulation = citiesWithDays.sort((a, b) => {
        return (b.population - a.population);
    });

    const sortedByDays = citiesWithDays.sort((a, b) => {
        return (b.days - a.days);
    });

    console.log(sortedByDays.map((city, index) => `${city.days} days in ${city.name} for about ${city.totalExpenses}€`).join('\n'));
}

loadInitialData();

console.log('Welcome to world explorer');
console.log('Input format: Departure city/airport;Budget in euros');

const stdin = process.openStdin();

process.on('SIGINT', () => {
    console.log('Saving cache data...');
    fs.writeFileSync('cache/flightsCache.json', JSON.stringify(CITY_FLIGHTS_CACHE));
    process.exit();
});

stdin.addListener('data', async (d) => {
    const args = d.toString().trim().split(';');

    if (args.length < 2 || isNaN(args[1]) || args[1] < 0) {
        console.log('Input format: Departure city/airport;Budget in euros');
        return;
    }

    const fromCity = CITIES.filter(city => {
        return city.altNames.map(name => name.toLowerCase()).indexOf(args[0].toLowerCase()) > -1 || city.name.toLowerCase() == args[0].toLowerCase() || city.asciiname.toLowerCase() == args[0].toLowerCase()
    })[0] || null;

    if (fromCity === null) {
        console.log(`Departure city / airport "${args[0]}" couldn't be found!`);
        return;
    }

    console.log(`Calculating destinations from "${args[0]}"..`);

    await findCitiesByBudget(fromCity, parseInt(args[1]));
});
