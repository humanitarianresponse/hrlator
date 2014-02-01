/**
 * hrlator module pattern
 */
var hrlator = (function () {

  // handsontable
  var ht;
  var _ht_rowLastEdited = -1;
  var _ht_validated = false;

  var htContactsRenderer = function() {
    var highlightedRow = null;

    return {
      getRenderFunction: function() {
        return function(instance, td, row, col, prop, value, cellProperties) {
          Handsontable.TextRenderer.apply(this, arguments);
          tdcheck = instance.getDataAtCell(row, self.data.cols.valid);
          // add class to parent
          $(td).parent().removeClass().addClass("hrlator-" + tdcheck);
          return td;
        }
      }
    }
  };

  // internal variables harcoded
  var _servers = {
    'PH': {serverUrlBase: 'https://philippines.humanitarianresponse.info', countryCode: 'PH'},
    'SS': {serverUrlBase: 'http://southsudan.humanitarianresponse.info',   countryCode: 'SS'}
  };
  var _contactPath = '/operational-presence/xml?search_api_views_fulltext';

  var phoneUtil = i18n.phonenumbers.PhoneNumberUtil.getInstance();
  var PNF = i18n.phonenumbers.PhoneNumberFormat;

  var _data;
  var _dictionary, _organizations, _clusters;

  // default states
  var StatusDefaults = ['planned', 'ongoing', 'completed'];

  // cluster prefix map
  var prefix_map = {
    'CCCM': 'CM',
    'WASH': 'W',
    'NFI': 'ES',
    'ETC': 'ET',
    'FSAC': 'FS',
    'Shelter': 'ES',
    'Food': 'FS',
    'EDU': 'E'
  };

  // INIT hrlator object
  // - set the country
  // - load data
  var init = function() {

    var deferred = $.Deferred();

    // double check cookie (already done in server side indeed)
    var server = jQuery.cookie('hrlator-server');
    if (!_servers[server]) {
      for(var _server in _servers) break;
      server = _server;
    }
    self.serverUrlBase = _servers[server].serverUrlBase;
    self.countryCode = _servers[server].countryCode;

    self.data.type = hrType;

    // get dictionary from hrlator
    var jqxhrDictionary = $.ajax({
    //  url: 'http://hrlator.humanitarianresponse.info/index.php',
      data: {'api': 'dictionary'},
      success: function(result) {
        self.dictionary = JSON.parse(result);
      },
    });

    // get cluster from server
    var jqxhrClusters = $.ajax({
      url: self.serverUrlBase + '/clusters.xml',
      error: function(jqXHR, textStatus, errorThrown) {
        alert('hrlator init ERROR loading from ' + self.serverUrlBase + '/clusters.xml');
      },
      success: function(result) {
        // parse result with jQuery and extract relevant field
        var _clusters = $('taxonomy_term_data', result).map(function () {
          return {Name: $(this).find('Name').text(), Prefix: $(this).find('Prefix').text()};
        }).get();
        self.clusters = _clusters;
      },
    });

    // get organizations from server
    var jqxhrOrganizations = $.ajax({
      url: self.serverUrlBase + '/organizations/xml',
      error: function(jqXHR, textStatus, errorThrown) {
        alert('hrlator init ERROR loading from ' + self.serverUrlBase + '/organizations.xml');
      },
      success: function(result) {
        // parse result with jQuery and extract relevant field
        var _organizations = $('taxonomy_term_data', result).map(function () {
          return {Name: $(this).find('Name').text(), Prefix: $(this).find('Acronym').text()};
        }).get();
        self.organizations = _organizations;
      },
    });

    $.when(jqxhrDictionary, jqxhrClusters, jqxhrOrganizations)
      .done(function (jqxhrDictionary, jqxhrClusters, jqxhrOrganizations) {
        // autocomplete organization
        self.autoComplete.organization = self.organizations.
          map(function (element) { return element.Name } ).
          concat( self.dictionary.
            filter( function(element) { return (element.Type=='organizations'); }).
            map(function (element) { return element.Initial }));
        // autocomplete cluster
        self.autoComplete.cluster = self.clusters.
          map(function (element) { return element.Name } ).
          concat( self.clusters.
            map(function (element) { return element.Prefix }));
        // resolve deferred so init.done() runs
        deferred.resolve();
      })
    .fail(function() {
      deferred.reject();
    });

    return deferred.promise();

  }

  // new data
  var newData = function(txtType) {
    if (_schema[txtType]) {
      var schema = _schema[txtType];
      self.data.type = txtType;
      self.data.columns = [];
      self.data.validateRow = schema.validateRow;
      schema.columns.
        filter(function(item) { return item.out }).
        forEach(function(item, i) {
          self.data.headers[i] = item.header;
          self.data.cols[item.column] = i;
          self.data.rows[0][i] = "";
          if (item.autoComplete) {
            self.data.columns[i] = {type: 'autocomplete', source: self.autoComplete[item.autoComplete],  strict: false};
          }
          else {
            self.data.columns[i] = {type: 'text'};
          }
        });
      return txtType;
    }
    else {
      return "";
    }
  }

  // status function
  var showStatus = function(txtStatus, width) {
    $('#hrlator-status span').text(txtStatus);
    $('#hrlator-status').width(width + '%').attr('aria-valuenow', width);
  }

  // validate cluster
  // 1 cluster_exists
  // 2 find_cluster
  function validateCluster(row, cols_cluster) {
    var clusters = {
      data:  row[cols_cluster].replace(/[,]/g,';').split(';'),
      checked: [],
      valid: 'success',
      comments: []
    }

    $.each(clusters.data, function(j, cluster) {
      cluster = cluster.trim();
      var i = 0;
      while (element = self.clusters[i]) {
        // check the list
        if (element.Name === cluster) {
          clusters.checked[j] = element.Name;
          clusters.comments[j] = '';
          break;
        }
        // check the prefix
        else if (element.Prefix === cluster) {
          clusters.checked[j] = element.Name;
          clusters.comments[j] = 'Cluster ' + cluster + ' (prefix) replaced by ' + element.Name;
          break;
        }
        // check prefix map
        else if (element.Prefix === prefix_map[cluster]) {
          clusters.checked[j] = element.Name;
          clusters.comments[j] = 'Cluster ' + cluster + ' (mapped to ' + prefix_map[cluster] + ') replaced by ' + element.Name;
          break;
        }
        // check for similarities
        else if (element.Name.indexOf(cluster)>=0) {
          if (!clusters.checked[j]) {
            clusters.checked[j] = element.Name;
            clusters.comments[j] = 'Cluster ' + cluster + ' replaced by ' + element.Name;
            // keep looping because this could ba a false positive
          }
        }
        i++;
      }
      if (!clusters.checked[j]) {
         clusters.checked[j] = cluster;
         clusters.valid = 'danger';
         clusters.comments.push('Cluster ' + cluster + ' not found');
      }
    });

    // remove duplicates
    var clustersChecked = clusters.checked.
      filter(function(value, index, self) {
        return self.indexOf(value) === index;
      })
    row[cols_cluster] = clustersChecked.join('; ');
    if (clustersChecked.length != clusters.checked.length) {
      clusters.comments.push('Duplicated clusters removed');
    }
    var clusters_comments = clusters.comments.
      filter(function(value, index, self) {
        return self.indexOf(value) === index;
      }).
      join('; ');

    return {valid: clusters.valid, comment: clusters_comments};

  }


  // regexp for email
  // http://stackoverflow.com/questions/46155/validate-email-address-in-javascript
  var reEmail = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/i;

  // validate organization
  // 1 consult_dictionary
  // 2 organization_exists
  // 3 find_organization_by_acronym
  function validateOrganization(row, cols_organization) {

    var organization = {
       data: row[cols_organization].trim(),
       checked: '',
       dictionary: '',
       valid: 'success',
       comment: '',
    }

    // 1 consult dictionary
    var i = 0;
    while (element = self.dictionary[i]) {
      if ('organizations' == element.Type && organization.data === element.Initial) {
        organization.dictionary = element.Replacement;
        organization.comment = 'Organization found in dictionary (' + organization.data + ')';
        break;
      }
      i++;
    }
    var organization_data = organization.dictionary ? organization.dictionary : organization.data;
    i = 0;
    while (element = self.organizations[i]) {
      // 2 organization_exists
      if (organization_data === element.Name) {
        organization.checked = element.Name;
        break;
      }
      // 3 find_organization_by_acronym
      else if (organization_data === element.Acronym) {
        organization.checked = element.Name;
        organization.comment = 'Organization found by acronym (' + organization.data + ')';
        break;
      }
      i++;
    }
    if (!organization.checked) {
      organization.checked = organization.data;
      organization.comment = 'Organization ' + organization.data + ' not found';
      organization.valid = 'danger';
    }

    row[cols_organization] = organization.checked;

    return {valid: organization.valid, comment: organization.comment};
  }

  function validateDate(row, cols_date, colName) {

    var date = {
       data: row[cols_date].trim().replace(/\W/g,'/'),
       checked: '',
       valid: 'success',
       comment: ''
    }

    var countSep = date.data.split('/').length - 1;
    var dataParsed = Date.parse(date.data);

    if (dataParsed) {
      date.valid = 'alert';
      // date is OK
      if (countSep == 2) {
        date.checked = dataParsed.toString("yyyy/MM/dd");
        date.valid = 'success';
      }
      // date in the form '15/nov' or 'dec 2014'
      else if (countSep == 1) {
        if (!dataParsed.config.day) {
          date.checked = date.data;
          date.comment = colName + ' is incomplete';
        }
        else {
          date.checked = dataParsed.toString("yyyy/MM/dd");
          date.comment = colName + ' valid date parsed from "' + date.data + '"';
        }
      }
      // date in the form 'december'
      else {
        date.checked = date.data;
        date.comment = colName + ' is incomplete';
      }
    }
    else {
      date.valid = 'danger';
      date.checked = date.data;
      date.comment = colName + ' not recognized';
    }

    row[cols_date] = date.checked;
    return {valid: date.valid, comment: date.comment};

  }

  // Handsontable row validation (after user leave the edited row)
  var afterSelectionEnd = function (r, c, r2, c2) {
    if ((_ht_rowLastEdited >= 0) && !_ht_validated && r != _ht_rowLastEdited) {
      var row = self.data.rows[_ht_rowLastEdited];
      row[self.data.cols.valid] = 'validating';
      self.ht.render();
      var rowValidated = self.data.validateRow(row);
      rowValidated.done(function() {
        var stats = hrlator.dataStats();
        hrlatorStatus(stats.message);
        self.ht.render();
      });
    }
  }

  var afterChange = function(change, source) {
    if ('edit'==source) {
      _ht_rowLastEdited = change[0][0];
      self.data.rows[_ht_rowLastEdited][self.data.cols.valid] = 'edited';
      self.ht.render();
      _ht_validated = false;
    }
  };

  // HRLator Activities row validation
  var validateActivitiesRow = function(row) {

    var cols = self.data.cols;
//console.log(row);

    // check empty row
    if (row.join('').length ===0) {
      row[cols.comments] = 'empty';
      return;
    }

    // clear validation
    validation = [];

    // validate organization
    if (cols.Organizations >=0 && row[cols.Organizations]) {
      validation[cols.Organizations] = validateOrganization(row, cols.Organizations);
    }

    // validate cluster
    if (cols.Clusters >= 0 && row[cols.Clusters]) {
      validation[cols.Clusters] = validateCluster(row, cols.Clusters);
    }

    // Primary Beneficiary
    if (cols.PrimBen >= 0 && row[cols.PrimBen].toString().trim()) {

      var PrimBen = {
        data: row[cols.PrimBen].toString().trim(),
        checked: '',
        valid: 'success',
        comment: ''
      }
      // default
      PrimBen.checked = PrimBen.data;

      // 1 consult dictionary
      $.each(self.dictionary, function(i, element) {
        if ('population_types' == element.Type && PrimBen.data === element.Initial) {
           PrimBen.checked = element.Replacement;
           PrimBen.comment = 'Primary Beneficiary found in dictionary (' + PrimBen.data + ')';
           return false;
        }
      });

      //validation[cols.PrimBen] = {valid: 'success', comment: 'checked'};
      validation[cols.PrimBen] = {valid: PrimBen.valid, comment: PrimBen.comment};

    }

    // Status
    if (cols.Status >= 0 && row[cols.Status]) {
      var Status = {
        data: row[cols.Status].trim().toLowerCase(),
        checked: '',
        valid: 'success',
        comment: ''
      }

      if (StatusDefaults.indexOf(Status.data) >= 0) {
        Status.checked = Status.data;
      }
      else {
        $.each(self.dictionary, function(i, element) {
          if ('activity_status' == element.Type && Status.data === element.Initial.toLowerCase()) {
            Status.checked = element.Replacement;
            return false
          }
        });
        if (!Status.checked) {
          Status.valid = 'danger';
          Status.checked = Status.data;
          Status.comment = 'Status not recognized';
        }
      }

      row[cols.Status] = Status.checked;
      validation[cols.Status] = {valid: Status.valid, comment: Status.comment};
    }

    // Date
    if (cols.DateStart >= 0 && row[cols.DateStart].trim()) {
      validation[cols.DateStart] = validateDate(row, cols.DateStart, 'Start date');
    }
    if (cols.DateEnd >= 0 && row[cols.DateEnd].trim()) {
      validation[cols.DateEnd] = validateDate(row, cols.DateEnd, 'End date');
    }

    // Ok, let's check the row
    var valid = 'success';
    var comments = [];
    for (var j in validation) {
      if (valid != 'danger') {
        valid = (validation[j].valid != 'success') ? validation[j].valid : valid;
      }
      if (validation[j].comment) {
        comments.push(validation[j].comment);
      }
    }
    row[cols.valid] = valid;
    row[cols.comments] = comments.join('; ');

    _ht_validated = true;

    return valid;
  }

  // HRLator contacts row validation
  var validateContactsRow = function(row) {

    var deferred = $.Deferred();
    var cols = self.data.cols;
    var promises = [];

    // check empty row
    if (row.join('').length ===0) {
      row[cols.comments] = 'empty';
      setTimeout(deferred.resolve, 100);
      return deferred.promise();
    }

    // clear validation
    var validation = [];

    // check email
    if (cols.email >= 0 && row[cols.email]) {
      // check for multiple emails (and raise an error in case)
      var countAt = row[cols.email].split("@").length - 1;
      // no @ in the line => error
      if (countAt == 0) {
        validation[cols.email] = { valid: 'danger', comment: 'Email address is invalid'};
      }
      // more than one address > error
      else if (countAt > 1) {
        validation[cols.email] = { valid: 'danger', comment: 'Only one email address is allowed'};
      }
      // regexp check
      else if (!reEmail.exec(row[cols.email])) {
        validation[cols.email] = { valid: 'danger', comment: 'Email address is invalid'};
      }
    }
    // validate organization
    if (cols.organization >=0 && row[cols.organization]) {
      validation[cols.organization] = validateOrganization(row, cols.organization);
    }

    // validate cluster
    if (cols.cluster >= 0 && row[cols.cluster]) {
      validation[cols.cluster] = validateCluster(row, cols.cluster);
    }

    // validate location
    // 1 find_location_by_name
    if (cols.location >= 0 && row[cols.location]) {
      locations = {
        data:  row[cols.location].trim().replace(/[,]/g,';').split(';').filter(function(e){return e}),
        checked: [],
        valid: 'success',
        comments: [],
        requests: [],
        deferred: $.Deferred()
      };
      if (locations.data.length > 1) {
        promises.push(locations.deferred);

        $.each(locations.data, function(j, location) {
          var location = location.trim();
          if (location.length) {
            locations.requests.push( $.ajax({
              url: hrlator.serverUrlBase + '/locations/xml',
              data: {'name': location},
              success: function(result) {
                // parse result with jQuery and extract relevant field from XML
                _locations = $('taxonomy_term_data', result).
                  filter(function(i, element) { return ($(element).find('Name').text().toLowerCase() == location.toLowerCase()); }).
                  map( function(i, element) {
                    var loc = {}
                    $(element).children().each(function(i, element) { loc[$(element).prop("tagName")] = $(element).text(); });
                    return loc;
                  });
                if (_locations.length < 1) {
                  locations.valid = 'danger';
                  locations.comments.push('Location ' + location + ' not found');
                }
              },
              error: function(result) {
                locations.valid = (locations.valid != 'danger') ? 'alert' : locations.valid;
                locations.comments.push('Location ' + location + ' not checked');
              }
            }) );
          }
        });

        $.when.apply(this, locations.requests).done(function () {
          validation[cols.location] = { valid: locations.valid, comment: locations.comments.join('; ') };
          locations.deferred.resolve();
        });

      }
    }

    // validate phone
    // 1 format_phone
    if (cols.phone >= 0 && row[cols.phone]) {
      // cleanup numbers and split
      // phones = phones.replace(/[,\/]/g,';').replace(/-/g,' ').replace(/[^0-9+(); ]/, '');
      phones = {
        data: row[cols.phone].toString().
          replace(/[,\/]/g,';').replace(/-/g,' ').replace(/[^0-9+(); ]/, '').
          split(";"),
        checked: [],
        valid: 'success',
        comments: []
      }
      $.each(phones.data, function(j, phone) {
        phone = phone.trim();
        if (phone.length) {

          var phoneParsed = phoneUtil.parse(phone, hrlator.countryCode);
          if (!phoneUtil.isValidNumber(phoneParsed)) {
            phones.comments.push("Phone number " + phone + " is invalid");
            phones.checked.push(phone);
            phones.valid = 'danger';
          }
          else {
            phones.checked.push(phoneUtil.format(phoneParsed, PNF.INTERNATIONAL));
          }

        }
      });
      row[cols.phone] = phones.checked.join('; ');
      validation[cols.phone] = {valid: phones.valid, comment: phones.comments.join('; ')};
    }

    // validate first last name
    // 1 determine First name and last name from full name
    if (cols.fullName >= 0 || cols.name >= 0) {
      // check if already edited!
      if ((row[cols.lastName].length + row[cols.firstName].length) == 0) {
        var colName = (cols.fullName > 0) ? cols.fullName : cols.name;
        var fullName = (cols.fullName >= 0) ? row[cols.fullName] : row[cols.name];
        var names = fullName.trim().split(' ');
        if (names.length != 2) {
          validation[colName] = {valid: 'danger', comment: 'Could not determine first name and last name from ' + fullName};
        }
        else {
          row[cols.firstName] = names[0];
          row[cols.lastName] = names[1];
          validation[colName] = {
            valid: 'success',
            comment: 'Separated ' + fullName + ' into First name: ' + names[0] + ' and Last name: ' + names[1]};
        }
      }
    }

    // contact exists in DB
    // 1 contact exists
    if (cols.lastName >= 0 && cols.firstName >= 0) {
      var lastName = row[cols.lastName] = row[cols.lastName].trim();
      if (lastName) {
        var firstName = row[cols.firstName] = row[cols.firstName].trim();
        if (firstName) {
          var _user_profiles;
          promises.push( $.ajax({
            url: hrlator.serverUrlBase + '/operational-presence/xml',
            data: {'search_api_views_fulltext': lastName},
            success: function(result) {
              // parse result with jQuery and extract relevant field from XML
              _user_profiles = $('search_api_index_user_profile', result).
                filter(function(i, element) {
                  return ($(element).find('firstName').text().toLowerCase() == firstName.toLowerCase());
                }).
                map( function(i, element) {
                  var profile = {}
                  $(element).children().each(function(i, element) {
                    profile[$(element).prop("tagName")] = $(element).text();
                  });
                  return profile;
                });
              if (_user_profiles.length > 0) {
                validation[cols.lastName] = {
                  valid: 'danger',
                  comment: 'Contact already exists in the database. See ' + hrlator.serverUrlBase + '/profile/' + _user_profiles[0].profileId};
              }
              else {
                validation[cols.lastName] = {valid: 'success'};
              }
            },
            error: function(result) {
              validation[cols.lastName] = {valid: 'alert', comment: 'Network error on contact validation with ' + hrlator.serverUrlBase};
            }
          }) );
        }
        else {
          validation[cols.firstName] = {valid: 'danger', comment: 'First Name is empty'};
        }
      }
      else {
        validation[cols.lastName] = {valid: 'danger', comment: 'Last Name is empty'};
      }
    }
    else {
      validation[cols.lastName] = {valid: 'danger', comment: 'Could not determine Last Name column'};
    }

    // Ok, let's check the row
    row[cols.valid] = 'validating';

    // http://stackoverflow.com/questions/5627284/pass-in-an-array-of-deferreds-to-when
    $.when.apply(this, promises).done(function () {
      var valid = 'success';
      var comments = [];
      for (var j in validation) {
        valid = ('danger' == validation[j].valid) ? 'danger' : valid;
        if (validation[j].comment) {
          comments.push(validation[j].comment);
        }
      }
      row[cols.valid] = valid;
      row[cols.comments] = comments.join('; ');

      _ht_validated = true;

      deferred.resolve();
    });

    return deferred.promise();

  }

  var dataStats = function() {
    var message = {log: "", strStats: [], progress: {}};
    var stats = {};
    var total = 0;
    self.data.rows
      .filter(function(el, i) { return (i > 0) && el[self.data.cols.valid] })
      .forEach(function(row) {
        stats[row[self.data.cols.valid]]++ ||  (stats[row[self.data.cols.valid]] = 1);
        total++});

    for (k in stats) {
      message.strStats.push( k + ': ' + stats[k]);
      message.progress[k] = {
        width: Math.round(stats[k] * 100 / total),
        text: stats[k]
      }
    }
    message.log = {text: message.strStats.join(' - ')};
    return {stats: stats, total: total, message: message};
  }

  // contacts headers
  var _schema = {
    contacts: { validateRow: validateContactsRow,
      columns: [
        {column: 'cluster',      out: true,  header: 'Clusters', autoComplete: 'cluster'},
        {column: 'salutation',   out: true,  header: 'Salutation'},
        {column: 'firstName',    out: true,  header: 'First name'},
        {column: 'lastName',     out: true,  header: 'Last name'},
        {column: 'fullName',     out: false, header: 'Full name'},
        {column: 'name',         out: false, header: 'Name'},
        {column: 'email',        out: true,  header: 'Email'},
        {column: 'phone',        out: true,  header: 'Telephones'},
        {column: 'organization', out: true,  header: 'Organization', autoComplete: 'organization'},
        {column: 'orgType',      out: true,  header: 'Organization Type'},
        {column: 'jobTitle',     out: true,  header: 'Job Title'},
        {column: 'location',     out: true,  header: 'Location'},
        {column: 'coordHub',     out: true,  header: 'Coordination Hub'},
        {column: 'fundings',     out: true,  header: 'Fundings'},
        {column: 'themes',       out: true,  header: 'Theme(s)'},
        {column: 'emergencies',  out: true,  header: 'Emergencies'},
        {column: 'valid',        out: true,  header: 'valid'},
        {column: 'comments',     out: true,  header: 'comments'}
      ],
    },
    activities: { validateRow: validateActivitiesRow,
      columns: [
        {column: 'Organizations', out: true,  header: 'Organizations', autoComplete: 'organization'},
        {column: 'OrgAcronym',    out: true,  header: 'Organizations Acronym'},
        {column: 'Clusters',      out: true,  header: 'Clusters', autoComplete: 'cluster'},
        {column: 'Locations',     out: true,  header: 'Locations'},
        {column: 'Title',         out: true,  header: 'Title'},
        {column: 'PrimBen',       out: true,  header: 'Primary Beneficiary'},
        {column: 'PrimBenNum',    out: true,  header: 'Number of primary beneficiaries'},
        {column: 'Status',        out: true,  header: 'Status'},
        {column: 'DateStart',     out: true,  header: 'Start Date'},
        {column: 'DateEnd',       out: true,  header: 'End Date'},
        {column: 'valid',         out: true,  header: 'valid'},
        {column: 'comments',      out: true,  header: 'comments'}
      ]
    }
  };

  // public
  var self = {
    // expose functions
    init: init,
    showStatus: showStatus,
    newData: newData,
    dataStats: dataStats,

    // Contacts
    validateContactsRow: validateContactsRow,
    htContactsRenderer: htContactsRenderer,

    // Activities
    validateActivitiesRow: validateActivitiesRow,
    htActivitieRenderer: htContactsRenderer,

    // handsontable live validation
    afterChange: afterChange,
    afterSelectionEnd: afterSelectionEnd,

    // expose and init data
    ht: ht,
    data: {
      rows: [ [] ],
      headers: [],
      cols: {},
      validateRow: '',
      stats: dataStats,
    },

    schema: _schema,
    servers: _servers,
    contactPath: _contactPath,
    serverUrlBase: "",
    countryCode: "",
    dictionary: [],
    organizations: [],
    clusters: [],
    autoComplete: {
      cluster: [],
      organization: []
    }
  }
  return self;

})();

function hrlatorStatus(message) {
  if (message.progress) {
    for (key in message.progress) {
      $('#hrlator-show .progress-bar-' + key)
        .width( message.progress[key].width + '%')
        .find('span').text(message.progress[key].text);
    }
    $('#hrlator-show .progress').show();
  }
  else {
    $('#hrlator-show .progress').hide();
  }
  if (message.log) {
    $('#hrlator-show .log span')
      .removeClass().addClass(message.log.class)
      .text(message.log.text)
      .show();
  }
  else {
    $('#hrlator-show .log span').hide();
  }
}


$(document).ready(function () {

  if (jQuery.cookie('hrlator-server')) {
    $('#settings-server select').val(jQuery.cookie('hrlator-server'));
  }

  $('#settings-server select').change(function() {
    var cc = $(this).val();
    if (hrlator.servers[cc]) {
      hrlator.countryCode = hrlator.servers[cc].countryCode;
      hrlator.serverUrlBase = hrlator.servers[cc].serverUrlBase;
      $.cookie('hrlator-server', cc);
    }

  });

});

