package com.gargmegham.portada

import android.content.Context
import com.lagradost.cloudstream3.plugins.CloudstreamPlugin
import com.lagradost.cloudstream3.plugins.Plugin

@CloudstreamPlugin
class Portada : Plugin() {
    override fun load(context: Context) {
        // Scaffold phase: provider/extractor sources will be registered later.
    }
}

