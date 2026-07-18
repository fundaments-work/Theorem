package work.fundamentals.theorem

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    @JvmStatic external fun initNdkContext(context: Any)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initNdkContext(applicationContext)
    super.onCreate(savedInstanceState)
  }
}
