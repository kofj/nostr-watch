import crypto from "crypto"
import {sort} from 'array-timsort'

export default {
  removeIgnoredTopics(topics){
    const ignored = this.store.prefs.ignoreTopics.split(',')
    return topics
      .filter( topic =>
        !ignored
          .map( ignoreTopic => ignoreTopic.trim() )
          .includes(topic[0])
      )
  },

  invalidateJob(name, force){
    let fn = () => {}

    if(!this.slug)
      console.warn('job slug is:', this.slug)

    if(this.store.jobs.isJobActive(this.slug))
      force = true

    fn =  (this?.[name] instanceof Function)? 
            this[name]:
            (this.invalidate instanceof Function)? 
              this.invalidate: 
              fn
    
    fn(force)
  },
  toggleFilter(ref, key, unique, reset, always){
    if(parseInt(this.store.filters?.count?.[ref]?.[key]) === 0)
      return
    const rule = this.store.filters.getRule(ref, key)
    if(rule?.length) {
      this.store.filters.removeRule(ref, key, unique, reset, always)
    } else {
      this.store.filters.addRule(ref, key, unique, reset, always)
    }
    this.refreshCounts(this.getRelays(this.store.relays.getAll))
  },
  refreshCounts(relays){
    if(Object.keys(this.store.stats?.nips).length) 
      this?.store?.stats?.nips?.forEach( nip => {
        this.store.filters.set(    
          this.getRelaysByNip(relays, parseInt( nip.key )).length,
          'count',
          'nips',
          nip.key,
        )
      })
    if(Object.keys(this.store.stats?.software).length)
      this.store.stats?.software?.forEach( software => {
        this.store.filters.set(
          this.getRelaysBySoftware(relays, software.key).length,
          'count',
          'software',
          software.key,
        )
      })
    if(Object.keys(this.store.stats?.countries).length)
      this.store.stats?.countries?.forEach( country => {
        this.store.filters.set(
          this.getRelaysByCountry(relays, country.key).length,
          'count',
          'countries',
          country.key,
        )
      })
    if(Object.keys(this.store.stats?.continents).length)
      this.store.stats?.continents?.forEach( continent => {
        this.store.filters.set(
          this.getRelaysByContinent(relays, continent.key).length,
          'count', 
          'continents', 
          continent.key
        )
      })
  },
  isPopulated(){
    return (
      this.store.prefs.clientSideProcessing
      && this.store.jobs.lastUpdate['relays/check']
    )
    ||
    (
      !this.store.prefs.clientSideProcessing
      && this.store.jobs.lastUpdate['relays/seed']
    )
  },
  chunk(chunkSize, array) {
    return array.reduce(function(previous, current) {
        var chunk;
        if (previous.length === 0 || 
                previous[previous.length -1].length === chunkSize) {
            chunk = [];
            previous.push(chunk);
        }
        else {
            chunk = previous[previous.length -1];
        }
        chunk.push(current);
        return previous;
    }, []); 
  },
  closePool: function( $pool ) {
    $pool.relays.forEach( $relay => this.closeRelay( $relay ) )
  },
  closeRelay: function( $relay ){
    if(!$relay.ws?.readyState || !$relay?.ws.OPEN)
      return 
    if($relay.ws.readyState === $relay.ws.OPEN )
      $relay.close()
  },
  queueKind3: async function(slug){
    this.queueJob(
      slug,
      async () => {
        await this.store.user.setKind3()
          .then( () => {
            this.store.relays.getFavorites.forEach( relay => {
              if(this.store.user?.kind3?.[relay])
                return 
              this.store.user.kind3[relay] = { read: false, write: false }
            })
            Object.keys(this.store.user.kind3).forEach( key => {
              this.store.relays.setFavorite(key)
            })
            this.store.jobs.completeJob(slug)
          })
          .catch( err => {
            console.error('error!', err)
            this.store.jobs.completeJob(slug)
          })
      },
      true
    )
  },
  queueJob: function(id, fn, unique){
    // console.log('queuing job', id, fn, unique)
    this.store.jobs.addJob({
      id: id,
      handler: fn,
      unique: unique
    })
  },

  getRelays(relays){
    if(!relays)
      relays = this.store.relays.getAll
    relays = this.filterRelays(relays)
    relays = this.sortRelays(relays)
    return relays
  },

  //CONVERT THESE TO COMPUTED!!!!
  getRelaysByNip(arr, needle){
    return arr?.filter( relay => this.store.results.get(relay)?.info?.supported_nips?.includes(needle) ) || []
  },
  getRelaysByValidPubKey(arr){
    return arr?.filter( relay => this.store.results.get(relay)?.pubkeyValid )  || []
  },
  getRelaysBySoftware(arr, needle){
    if(needle === 'unknown')
      return arr?.filter( relay => !this.store.results.get(relay)?.info?.software )  || []
    else
      return arr?.filter( relay => this.store.results.get(relay)?.info?.software?.includes(needle) )  || []
  },
  getRelaysByCountry(arr, needle){
    if(needle === 'unknown')
      return arr?.filter( relay => !this.store.relays.getGeo(relay)?.country )  || []
    else
      return arr?.filter( relay => this.store.relays.getGeo(relay)?.country?.includes(needle) )  || []
  },
  getRelaysByContinent(arr, needle){
    if(needle === 'unknown')
    return arr?.filter( relay => !this.store.relays.getGeo(relay)?.continentName ) || []
    else
    return arr?.filter( relay => this.store.relays.getGeo(relay)?.continentName?.includes(needle) ) || []
  },
  //end computed.


  filterRelays(relays){
    // await new Promise( resolve => setTimeout(resolve, 300))
    const haystacks = ['nips','valid/nip11','software','countries','continents','aggregate']
    let filtered = [...relays]
    haystacks.forEach( haystack => {
      const needles = this.store.filters.getRules(haystack)
      needles?.forEach( needle => {
        if(!this.store.filters.enabled && !this.store.filters.alwaysEnabled?.[haystack])
          return 
        if(haystack === 'nips')
          filtered = this.getRelaysByNip(filtered, parseInt(needle))

        if(haystack === 'valid/nip11')
          filtered = this.getRelaysByValidPubKey(filtered)

        if(haystack === 'software')
          filtered = this.getRelaysBySoftware(filtered, needle)

        if(haystack === 'countries')
          filtered = this.getRelaysByCountry(filtered, needle)

        if(haystack === 'continents')
          filtered = this.getRelaysByContinent(filtered, needle)

        if(haystack === 'aggregate'){
          const aggregate = this.store.relays.getRelays(needle, this.store.results.all)
          filtered = filtered.filter( relay => aggregate.includes(relay) )
        }
        
      })
    })
    return filtered
  },

  
  sortRelays(relays){
    // console.log('first visit', this.store.prefs.isFirstVisit)
    // if(this.store.prefs.isFirstVisit)
    //   return this.store.relays.getShuffled

    if(this.store.prefs.sortLatency)
      sort(relays, (relay1, relay2) => {
        let a = this.store.results.get(relay1)?.latency?.average || 100000,
            b = this.store.results.get(relay2)?.latency?.average || 100000
        return a-b
      })
    sort(relays, (relay1, relay2) => {
      let x = this.store.results.get(relay1)?.check?.connect || false,
          y = this.store.results.get(relay2)?.check?.connect || false
      return (x === y)? 0 : x? -1 : 1;
    })
    if(this.store.prefs.sortLatency)
      sort(relays, (relay1, relay2) => {
        let a = this.store.results.get(relay1)?.latency?.average || null,
            b = this.store.results.get(relay2)?.latency?.average || null
        return (b != null) - (a != null) || a - b;
      })
    // if(this.store.prefs.sortUptime && this.store.layout.getActive('relays/find') !== 'paid')
    //   sort(relays, (relay1, relay2) => {
    //     let a = this.store.results.all?.[relay1]?.uptime || 0,
    //         b = this.store.results.all?.[relay2]?.uptime || 0
    //     return b-a
    //   })
    if(this.store.prefs.doPinFavorites)
      sort(relays, (relay1, relay2) => {
        let x = this.store.relays.isFavorite(relay1) || false,
            y = this.store.relays.isFavorite(relay2) || false
        return (x === y)? 0 : x? -1 : 1;
      })
    if(this.store.prefs.sortFees && this.store.layout.getActive('relays/find') === 'paid')
      sort(relays, (relay1, relay2) => {
        let x = this.store.results.get(relay1)?.info?.fees?.admission?.[0]?.amount || 1000000000000,
            y = this.store.results.get(relay2)?.info?.fees?.admission?.[0]?.amount || 1000000000000
        return x-y
      })
    // relays = this.sortRelaysFavoritesOnTop(relays)
    return Array.from(new Set(relays))
  },
    setCache: function(result){
      this.$storage.setStorageSync(result.url, result);      
    },

    getCache: function(key){
      return this.$storage.getStorageSync(key)
    },

    getHostname: function(relay){
      return relay.replace('wss://', '')
    },

    removeCache: function(key){
      return this.$storage.removeStorageSync(key)
    },

    async storageClearAll(tries){
      if(!tries)
        tries = 0
      Object.keys(this.store).forEach( store => this.store[store].$reset )
      localStorage.clear()
      if(tries < 3)
        this.storageClearAll(tries++)
      else 
        await new Promise( resolve => 
          setTimeout( () => {
            this.$forceUpdate
            resolve()
          }, 100) 
        )
    },

    getAggregate: function(result) {

      if(!result?.latency?.connect)
        return 'offline'

      if(result?.check.connect && result?.check.read && result?.check.write)
        return 'public'

      // else if(this.isPayToRelay(result.url))
      //   return 'restricted'

      if(result?.check.connect && (result?.check.read || result?.check.write))
        return 'restricted'

      if(result?.check.connect)
        return 'restricted'
    },

    relaysTotal: function() {
      return this.relays.length
    },

    relaysConnected: function() {
      return Object.entries(this.store.relays.results).length
    },

    // relaysComplete: function() {
    //   return this.relays?.filter(relay => this.store.relays.results?.[relay]?.state == 'complete').length
    // },

    sha1: function(message) {
      const hash = crypto.createHash('sha1').update(JSON.stringify(message)).digest('hex')
      return hash
    },

    isDone: function(){
      return this.relaysTotal()-this.relaysComplete() <= 0
    },

    loadingComplete: function(){
      return this.isDone() ? 'loaded' : ''
    },
    

    // getReadabilityPercentage(relay){
    //   const pulses = this.store.stats.getPulse(relay)
    //   if(!pulses || !Object.keys(pulses).length )
    //     return
    //   const totalPulses = Object.keys(pulses).length 
    //   const totalOnline = Object.entries(pulses).reduce(
    //       (acc, value) => value[1].latency ? acc+1 : acc,
    //       0
    //   );
    //   return Math.floor((totalOnline/totalPulses)*100)
    // },

    // getUptimePercentage(relay){
    //   const pulses = this.store.stats.getPulse(relay)
    //   console.log(relay, pulses)
    //   if(!pulses || !Object.keys(pulses).length )
    //     return
    //   const totalPulses = Object.keys(pulses).length 
    //   return Math.floor((totalPulses/48)*100)
    // },

    getUptimePercentage(relay){
      const pulses = this.store.stats.getPulse(relay)
      if(!pulses || !Object.keys(pulses).length )
        return
      const totalPulses = Object.keys(pulses).length 
      const totalOnline = Object.entries(pulses).reduce(
          (acc, value) => value[1].latency ? acc+1 : acc,
          0
      );
      return Math.floor((totalOnline/totalPulses)*100)
    },

    setUptimePercentage(relay){
      const result = { ability: {} };

      ['connect','read','write'].forEach(ability => {

        result.ability[ability] = this.getAbilityRate(ability, relay)
      })

      this.store.results.mergeDeep( { [relay]: result  } )

      return result
    },

    delay(ms) {
      return new Promise(resolve => setTimeout( () => resolve(), ms));
    },
    sort_by_latency(ascending) {
      const self = this
      return function (a, b) {
        // equal items sort equally
        if (self.result?.[a]?.latency.final === self.result?.[b]?.latency.final) {
            return 0;
        }

        // nulls sort after anything else
        if (self.result?.[a]?.latency.final === null) {
            return 1;
        }
        if (self.result?.[b]?.latency.final === null) {
            return -1;
        }

        // otherwise, if we're ascending, lowest sorts first
        if (ascending) {
            return self.result?.[a]?.latency.final - self.result?.[b]?.latency.final;
        }

        // if descending, highest sorts first
        return self.result?.[b]?.latency.final-self.result?.[a]?.latency.final;
      };
    },
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch($e) {
        ////console.log('Cannot copy');
      }
    },
}